const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 10000;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || FRONTEND_URL)
  .split(',').map(x => x.trim()).filter(Boolean);

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON environment variable.');
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS.'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); }
}));

function requirePaystackKey() {
  if (!PAYSTACK_SECRET_KEY || !/^sk_(test|live)_/.test(PAYSTACK_SECRET_KEY)) {
    const e = new Error('Paystack secret key is not configured on the backend.');
    e.status = 503;
    throw e;
  }
  return PAYSTACK_SECRET_KEY;
}
async function signedIn(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Please sign in first.' });
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (e) { return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' }); }
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'haven-house-payments' }));

app.post('/api/payments/initialize', signedIn, async (req, res) => {
  let orderRef;
  try {
    const secret = requirePaystackKey();
    const { items, customerName, customerEmail, customerPhone, orderType = 'takeaway', notes = '' } = req.body || {};
    if (!Array.isArray(items) || !items.length || items.length > 30) return res.status(400).json({ error: 'Your basket is empty or invalid.' });
    if (!customerName || !customerEmail || !customerPhone) return res.status(400).json({ error: 'Complete all customer details.' });
    const ids = [...new Set(items.map(x => String(x.menuItemId || '')))];
    const docs = await Promise.all(ids.map(id => db.collection('menu').doc(id).get()));
    const byId = new Map(docs.filter(d => d.exists).map(d => [d.id, d.data()]));
    const clean = []; let subtotal = 0;
    for (const item of items) {
      const m = byId.get(String(item.menuItemId)); const qty = Number(item.quantity);
      if (!m || m.available !== true || !Number.isInteger(qty) || qty < 1 || qty > 30) return res.status(409).json({ error: 'A selected menu item is unavailable. Refresh your basket.' });
      const price = Number(m.price);
      if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid menu price in Firestore.');
      subtotal += price * qty;
      clean.push({ menuItemId: String(item.menuItemId), name: m.name, price, quantity: qty });
    }
    const setting = await db.doc('settings/public').get();
    const fee = Number(setting.exists ? setting.data().serviceFee || 0 : 0);
    const total = subtotal + fee;
    if (!Number.isSafeInteger(total) || total < 1 || total > 1000000) return res.status(400).json({ error: 'Order total is outside the permitted range.' });
    orderRef = db.collection('orders').doc();
    await orderRef.set({
      userId: req.user.uid,
      customerName: String(customerName).slice(0, 80),
      customerEmail: String(customerEmail).slice(0, 160),
      customerPhone: String(customerPhone).slice(0, 30),
      orderType: orderType === 'dine-in' ? 'dine-in' : 'takeaway',
      notes: String(notes).slice(0, 300), items: clean, subtotal, serviceFee: fee, total,
      currency: 'KES', paymentMethod: 'paystack', paymentStatus: 'pending', status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    const callbackBase = FRONTEND_URL || req.headers.origin;
    if (!callbackBase) throw new Error('Set FRONTEND_URL in Render environment variables.');
    const callback = `${callbackBase.replace(/\/$/, '')}/payment-callback.html?order=${orderRef.id}`;
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(customerEmail), amount: total * 100, currency: 'KES', reference: orderRef.id, callback_url: callback,
        metadata: { orderId: orderRef.id, userId: req.user.uid } })
    });
    const data = await response.json();
    if (!response.ok || !data.status || !data.data?.authorization_url) throw new Error(data.message || 'Paystack initialization failed.');
    await orderRef.update({ paymentReference: data.data.reference });
    return res.json({ authorizationUrl: data.data.authorization_url, orderId: orderRef.id, reference: data.data.reference });
  } catch (e) {
    if (orderRef) await orderRef.update({ paymentStatus: 'initialization-failed' }).catch(() => {});
    console.error('Payment initialization error:', e.message);
    return res.status(e.status || 500).json({ error: e.status === 503 ? e.message : 'Could not initialize payment. Please try again.' });
  }
});

app.post('/api/payments/verify', signedIn, async (req, res) => {
  try {
    const secret = requirePaystackKey();
    const orderId = String(req.body?.orderId || '');
    const reference = String(req.body?.reference || '');
    if (!orderId || !reference || orderId.length > 150 || reference.length > 150) return res.status(400).json({ error: 'Payment reference is missing.' });
    const orderRef = db.collection('orders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists || snap.data().userId !== req.user.uid) return res.status(404).json({ error: 'Order not found.' });
    if (snap.data().paymentStatus === 'paid') return res.json({ paid: true, orderId });
    if (reference !== snap.data().paymentReference) return res.status(400).json({ error: 'Payment reference does not match this order.' });
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
    const result = await response.json();
    if (!response.ok || !result.status || result.data?.status !== 'success' || result.data.reference !== snap.data().paymentReference || Number(result.data.amount) !== snap.data().total * 100 || result.data.currency !== 'KES') {
      return res.status(402).json({ error: 'Payment has not been verified as successful.' });
    }
    await orderRef.update({ paymentStatus: 'paid', paidAt: admin.firestore.FieldValue.serverTimestamp(), paystackTransactionId: String(result.data.id) });
    return res.json({ paid: true, orderId });
  } catch (e) {
    console.error('Payment verification error:', e.message);
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Unable to verify payment. Please contact support.' });
  }
});

app.post('/api/paystack/webhook', async (req, res) => {
  try {
    const secret = requirePaystackKey();
    const signature = req.headers['x-paystack-signature'];
    const expected = crypto.createHmac('sha512', secret).update(req.rawBody || Buffer.from(JSON.stringify(req.body))).digest('hex');
    const a = Buffer.from(String(signature || '')); const b = Buffer.from(expected);
    if (!signature || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).send('Invalid signature');
    const event = req.body;
    if (event.event === 'charge.success') {
      const ref = String(event.data?.reference || '');
      const orderRef = db.collection('orders').doc(ref);
      const snap = await orderRef.get();
      if (snap.exists && Number(event.data.amount) === snap.data().total * 100 && event.data.currency === 'KES' && ref === snap.data().paymentReference) {
        await orderRef.update({ paymentStatus: 'paid', paidAt: admin.firestore.FieldValue.serverTimestamp(), paystackTransactionId: String(event.data.id) });
      }
    }
    return res.status(200).send('OK');
  } catch (e) { console.error('Webhook error:', e.message); return res.status(500).send('Webhook processing failed'); }
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: 'Server error.' });
});
app.listen(PORT, () => console.log(`Haven House payment API listening on ${PORT}`));
