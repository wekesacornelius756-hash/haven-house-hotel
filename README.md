# Haven House — Hotel & Takeaway Billing System

A responsive 10-page customer and staff application built with HTML, CSS, vanilla JavaScript modules, Firebase Authentication, Cloud Firestore and Firebase Cloud Functions. The theme uses premium golden-brown styling.

## 10 pages
1. `index.html` — landing page and featured meals
2. `menu.html` — live menu, search and categories
3. `guest.html` — read-only guest menu
4. `auth.html` — email/password sign-in, signup with repeat password, forgot-password email
5. `cart.html` — basket and secure checkout
6. `account.html` — account details, logout and change password (requires current password)
7. `admin.html` — administrator dashboard, menu, hotel branding, orders and support inbox
8. `waiter.html` — staff POS and receipt printing
9. `chat.html` — customer/admin support chat
10. `payment-callback.html` — server-verified payment result

## Firebase setup
The Firebase configuration in `js/firebase-config.js` uses the project configuration supplied by the owner. In Firebase Console:
- Enable **Authentication → Email/Password**.
- Create the Cloud Firestore database.
- Add your Vercel production domains to Authentication → Settings → Authorized domains.
- Deploy Firestore rules: `firebase deploy --only firestore:rules`.
- This build does **not** use Firebase Storage and intentionally contains no Storage rules or Storage SDK imports. Food photos and the hotel logo use secure HTTPS image URLs stored as normal Firestore fields.

## First administrator
1. Create your own account through `auth.html`.
2. In Firebase Console → Authentication, copy that account's UID.
3. From the project root, authenticate the Firebase Admin SDK using a service account (or Application Default Credentials) and run:
   `cd functions && npm install`
   `node make-admin.js YOUR_AUTH_UID`
4. Sign in again. Do not make an admin role editable from the public signup form.

## Live Paystack (KES)
The Cloud Functions code requires a real Paystack **Live Secret Key**. Never paste it into HTML, JavaScript, Vercel public environment variables, or this ZIP.

From the project root:
1. `firebase functions:secrets:set PAYSTACK_SECRET_KEY` — enter the live `sk_live_...` key in the secure prompt.
2. `firebase deploy --only functions`.
3. In Paystack Dashboard, configure the webhook to the deployed `paystackWebhook` HTTPS function URL for region `africa-south1`.
4. Confirm your live Paystack account is enabled for the transaction channels/currency you intend to use and complete a small real payment before launch.

The backend recalculates menu prices from Firestore, creates the pending order, initializes Paystack, and verifies the returned transaction against the saved order amount, reference and currency. Live payments are not active until you configure the secret and deploy the functions.

## Deploy customer and admin as two Vercel links
Vercel does not create two separate deployment URLs from one `vercel.json`. This repository is prepared for **two Vercel projects** connected to the same Git repository:

### Customer website
- Create Vercel Project 1.
- Set Root Directory to `hotel-billing` (the folder containing the main `vercel.json`).
- Deploy. This is the customer-facing URL.

### Separate admin URL
- Create Vercel Project 2 from the same repository.
- Set Root Directory to `hotel-billing/admin-deploy`.
- Deploy. This project serves the administrator dashboard at its own Vercel URL.
- Both projects use the same Firebase project and Firestore data. Keep the admin URL private and continue enforcing the Firestore role rules; obscuring the URL is not security.

If your repository root is already the `hotel-billing` folder, use `.` as the customer Root Directory and `admin-deploy` as the admin Root Directory.

## Menu images and online food
In Admin → Menu management, choose **Load starter food menu** to add sample dishes with online Unsplash image URLs. Admins can edit names, descriptions, categories, prices and image URLs; hide a meal to remove it from customer menus, or permanently delete it. Use images you have permission to use and keep their URLs HTTPS. No image files are uploaded to Firebase Storage.

## Receipt printing, Bluetooth and PDF
The waiter POS opens a receipt with adjustable 58 mm, 80 mm and A4 layouts, adjustable text size, a Code 128 barcode, order reference, totals and a thank-you note at the bottom. Choose **Print / Save PDF** in the receipt window. On Android, pair the Bluetooth thermal printer in Android Bluetooth settings and install/enable its manufacturer print service (or a compatible system print service); then select it in the Android print dialog. This is the browser-supported way to print to Bluetooth printers. Direct Bluetooth ESC/POS control is not universal in web browsers and depends on printer model, Bluetooth profile and browser support.

## Notes before production
- Test account creation, reset emails, role permissions, order creation, Paystack live payment, webhook delivery, refund handling and print layouts on your own deployed domains.
- Set the correct Firebase Functions region consistently (`africa-south1`).
- Configure your own support email, hotel name, tagline, logo HTTPS URL and service fee from Admin → Hotel settings.
- The starter food menu is sample data; verify prices, descriptions, allergen information and image rights before publishing.
- Never grant admin roles from client-side code. The included `make-admin.js` uses the Firebase Admin SDK and trusted credentials.

## Render payment backend

For the Render-hosted payment API (while keeping Firebase Authentication and Firestore), follow `RENDER-DEPLOYMENT.md`. Set the Render service root directory to `render-backend`, then update `js/backend-config.js` with the deployed Render URL and redeploy the frontend. Configure Paystack's webhook as `/api/paystack/webhook` on that Render service.
