/* SkyChat - Login/Signup JavaScript */

const API_URL = '/api/auth/users';

// Check if already logged in
if (localStorage.getItem('access_token')) {
  window.location.href = '/chat/';
}

// Initialize - show login form by default
document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('login-form').classList.add('active');
});

// Toggle between login and signup forms
function toggleForms(formType) {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const authTitle = document.getElementById('auth-title');
  const authSubtitle = document.getElementById('auth-subtitle');

  // Clear messages
  hideAllMessages();

  if (formType === 'signup') {
    loginForm.classList.remove('active');
    signupForm.classList.add('active');
    authTitle.textContent = 'Create Account';
    authSubtitle.textContent = 'Join SkyChat and start chatting today';
  } else {
    signupForm.classList.remove('active');
    loginForm.classList.add('active');
    authTitle.textContent = 'Welcome Back';
    authSubtitle.textContent = 'Sign in to continue to SkyChat';
  }
}

// Show message
function showMessage(elementId, message, type) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.className = 'message ' + type + ' show';

    // Auto hide after 5 seconds
    setTimeout(function () {
      el.classList.remove('show');
    }, 5000);
  }
}

// Hide all messages
function hideAllMessages() {
  document.querySelectorAll('.message').forEach(function (el) {
    el.classList.remove('show');
  });
}

// Handle login
async function handleLogin(event) {
  event.preventDefault();

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const button = event.target.querySelector('button[type="submit"]');

  if (!username || !password) {
    showMessage('login-message', 'Please fill in all fields', 'error');
    return;
  }

  // Show loading state
  const originalText = button.innerHTML;
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
  button.disabled = true;

  try {
    const response = await fetch(API_URL + '/login/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (response.ok && data.access) {
      localStorage.setItem('access_token', data.access);
      localStorage.setItem('refresh_token', data.refresh);
      showMessage('login-message', 'Login successful! Redirecting...', 'success');
      setTimeout(function () {
        // Cache clear karo login se pehle
        sessionStorage.clear();
        if ('caches' in window) {
          caches.keys().then(function (names) {
            names.forEach(function (name) { caches.delete(name); });
          });
        }
        window.location.href = '/chat/';
      }, 800);
    } else {
      const errorMsg = data.detail || data.error || 'Invalid credentials';
      showMessage('login-message', errorMsg, 'error');
    }
  } catch (error) {
    console.error('Login error:', error);
    showMessage('login-message', 'Connection error. Please try again.', 'error');
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

// Handle signup
async function handleSignup(event) {
  event.preventDefault();

  const firstName = document.getElementById('signup-firstname').value.trim();
  const lastName = document.getElementById('signup-lastname').value.trim();
  const username = document.getElementById('signup-username').value.trim();
  const password = document.getElementById('signup-password').value;
  const password2 = document.getElementById('signup-password2').value;
  const button = event.target.querySelector('button[type="submit"]');

  // Validation
  if (!firstName || !username || !password || !password2) {
    showMessage('signup-message', 'Please fill in all required fields', 'error');
    return;
  }

  if (username.length < 3) {
    showMessage('signup-message', 'Username must be at least 3 characters', 'error');
    return;
  }

  if (password.length < 6) {
    showMessage('signup-message', 'Password must be at least 6 characters', 'error');
    return;
  }

  if (password !== password2) {
    showMessage('signup-message', 'Passwords do not match', 'error');
    return;
  }

  // Show loading state
  const originalText = button.innerHTML;
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating account...';
  button.disabled = true;

  try {
    const response = await fetch(API_URL + '/register/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        username: username,
        password: password,
        password2: password2
      })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('signup-message', 'Account created! Please sign in.', 'success');
      setTimeout(function () {
        toggleForms('login');
        document.getElementById('login-username').value = username;
        document.getElementById('login-password').focus();
      }, 1500);
    } else {
      let errorMsg = 'Registration failed';
      if (data.username) {
        errorMsg = 'Username already exists';
      } else if (data.detail) {
        errorMsg = data.detail;
      } else if (data.error) {
        errorMsg = data.error;
      }
      showMessage('signup-message', errorMsg, 'error');
    }
  } catch (error) {
    console.error('Signup error:', error);
    showMessage('signup-message', 'Connection error. Please try again.', 'error');
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

// Toggle password visibility
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const icon = btn.querySelector('i');

  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

// Check password match in real-time
function checkPasswordMatch() {
  const pwd1 = document.getElementById('signup-password').value;
  const pwd2 = document.getElementById('signup-password2').value;
  const hint = document.getElementById('pwd-match');

  if (!pwd2) {
    hint.textContent = '';
    hint.className = 'pwd-match-hint';
    return;
  }

  if (pwd1 === pwd2) {
    hint.textContent = '✓ Passwords match';
    hint.className = 'pwd-match-hint match';
  } else {
    hint.textContent = '✗ Passwords do not match';
    hint.className = 'pwd-match-hint no-match';
  }
}
