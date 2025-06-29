// auth.js
// Handles Firebase phone authentication flow for Drifty app.
// Replace placeholder IDs with your actual UI element IDs.

// === DOM ELEMENTS ===
const phoneInput = document.getElementById('phone-input'); // <input>
const sendBtn = document.getElementById('send-otp-btn');   // <button>
const otpInput = document.getElementById('otp-input');     // <input>
const verifyBtn = document.getElementById('verify-otp-btn'); // <button>
const errorBox = document.getElementById('auth-error');    // <div/span> for messages

// Guard for missing elements (so file doesn't crash if IDs differ)
if (sendBtn && phoneInput) {
  // Configure invisible reCAPTCHA tied to the send button
  window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier(sendBtn, {
    'size': 'invisible',
    'callback': () => {
      // reCAPTCHA solved automatically.
    }
  });

  // Send OTP handler
  sendBtn.addEventListener('click', async () => {
    const phoneNumber = phoneInput.value.trim();
    if (!phoneNumber) return showError('Enter a valid phone number');

    try {
      const appVerifier = window.recaptchaVerifier;
      window.confirmationResult = await firebase.auth().signInWithPhoneNumber(phoneNumber, appVerifier);
      showError('OTP sent!');
    } catch (err) {
      console.error(err);
      showError(err.message);
    }
  });
}

// Verify OTP handler
if (verifyBtn && otpInput) {
  verifyBtn.addEventListener('click', async () => {
    const code = otpInput.value.trim();
    if (!code) return showError('Enter the OTP');

    try {
      await window.confirmationResult.confirm(code);
      // Firebase onAuthStateChanged in auth.html will redirect to home.
    } catch (err) {
      console.error(err);
      showError(err.message);
    }
  });
}

function showError(msg) {
  if (errorBox) {
    errorBox.textContent = msg;
  } else {
    alert(msg);
  }
}
