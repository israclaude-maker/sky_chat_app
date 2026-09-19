/* SkyChat - Login/Signup JavaScript */

const API_URL = "/api/auth/users";

// Check if already logged in — verify token is not expired before redirecting
// Check if already logged in — expired access token ho to refresh token se naya lo
(function () {
  var t = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
  var r = localStorage.getItem("refresh_token") || sessionStorage.getItem("refresh_token");

  function isValid(token) {
    try {
      var b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      var payload = JSON.parse(atob(b64));
      return payload.exp && payload.exp * 1000 > Date.now();
    } catch (e) {
      return false;
    }
  }

  function clearTokens() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("refresh_token");
  }

  // 1) Access token abhi valid hai
  if (t && isValid(t)) {
    window.location.href = "/chat/";
    return;
  }

  // 2) Access token expire, magar refresh token maujood hai
  if (r) {
    fetch("/api/auth/token/refresh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: r }),
    })
      .then(function (res) {
        if (!res.ok) {
          if (res.status === 400 || res.status === 401) clearTokens();
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.access) return;
        var store = localStorage.getItem("refresh_token") ? localStorage : sessionStorage;
        store.setItem("access_token", data.access);
        if (data.refresh) store.setItem("refresh_token", data.refresh);
        window.location.href = "/chat/";
      })
      .catch(function () {
        /* internet nahi hai to tokens delete mat karo */
      });
    return;
  }

  // 3) Kuch bhi nahi
  clearTokens();
})();

// Initialize - show login form by default
document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("login-form").classList.add("active");
});

// Toggle between login and signup forms
function toggleForms(formType) {
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const authTitle = document.getElementById("auth-title");
  const authSubtitle = document.getElementById("auth-subtitle");

  // Clear messages
  hideAllMessages();

  if (formType === "signup") {
    loginForm.classList.remove("active");
    signupForm.classList.add("active");
    authTitle.textContent = "Create Account";
    authSubtitle.textContent = "Join SkyChat and start chatting today";
  } else {
    signupForm.classList.remove("active");
    loginForm.classList.add("active");
    authTitle.textContent = "Welcome Back";
    authSubtitle.textContent = "Sign in to continue to SkyChat";
  }
}

// Show message
function showMessage(elementId, message, type) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.className = "message " + type + " show";

    // Auto hide after 5 seconds
    setTimeout(function () {
      el.classList.remove("show");
    }, 5000);
  }
}

// Hide all messages
function hideAllMessages() {
  document.querySelectorAll(".message").forEach(function (el) {
    el.classList.remove("show");
  });
}

// Handle login
async function handleLogin(event) {
  event.preventDefault();

  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const button = event.target.querySelector('button[type="submit"]');

  if (!username || !password) {
    showMessage("login-message", "Please fill in all fields", "error");
    return;
  }

  // Show loading state
  const originalText = button.innerHTML;
  button.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';
  button.disabled = true;

  try {
    const response = await fetch(API_URL + "/login/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (response.ok && data.access) {
      var rememberMe = document.getElementById("remember-me")
        ? document.getElementById("remember-me").checked
        : true;

      // Remember Me checked = localStorage (survives app restart, ~30 days)
      // Unchecked = sessionStorage (cleared when app fully quits)
      localStorage.setItem("remember_me", rememberMe ? "1" : "0");
      var store = rememberMe ? localStorage : sessionStorage;
      var other = rememberMe ? sessionStorage : localStorage;
      other.removeItem("access_token");
      other.removeItem("refresh_token");
      store.setItem("access_token", data.access);
      store.setItem("refresh_token", data.refresh);
      showMessage(
        "login-message",
        "Login successful! Redirecting...",
        "success",
      );
      setTimeout(function () {
        // Cache clear karo login se pehle
        sessionStorage.clear();
        if ("caches" in window) {
          caches.keys().then(function (names) {
            names.forEach(function (name) {
              caches.delete(name);
            });
          });
        }
        window.location.href = "/chat/";
      }, 800);
    } else {
      const errorMsg = data.detail || data.error || "Invalid credentials";
      showMessage("login-message", errorMsg, "error");
    }
  } catch (error) {
    console.error("Login error:", error);
    showMessage(
      "login-message",
      "Connection error. Please try again.",
      "error",
    );
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

// Handle signup
async function handleSignup(event) {
  event.preventDefault();

  const firstName = document.getElementById("signup-firstname").value.trim();
  const lastName = document.getElementById("signup-lastname").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const username = document.getElementById("signup-username").value.trim();
  const password = document.getElementById("signup-password").value;
  const password2 = document.getElementById("signup-password2").value;
  const button = event.target.querySelector('button[type="submit"]');

  // Validation
  if (!firstName || !email || !username || !password || !password2) {
    showMessage(
      "signup-message",
      "Please fill in all required fields",
      "error",
    );
    return;
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showMessage(
      "signup-message",
      "Please enter a valid email address",
      "error",
    );
    return;
  }

  if (username.length < 3) {
    showMessage(
      "signup-message",
      "Username must be at least 3 characters",
      "error",
    );
    return;
  }

  if (password.length < 6) {
    showMessage(
      "signup-message",
      "Password must be at least 6 characters",
      "error",
    );
    return;
  }

  if (password !== password2) {
    showMessage("signup-message", "Passwords do not match", "error");
    return;
  }

  // Show loading state
  const originalText = button.innerHTML;
  button.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i> Creating account...';
  button.disabled = true;

  try {
    const response = await fetch(API_URL + "/register/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        email: email,
        username: username,
        password: password,
        password2: password2,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      showMessage(
        "signup-message",
        "Account created! Please sign in.",
        "success",
      );
      setTimeout(function () {
        toggleForms("login");
        document.getElementById("login-username").value = username;
        document.getElementById("login-password").focus();
      }, 1500);
    } else {
      let errorMsg = "Registration failed";
      if (data.email) {
        errorMsg = Array.isArray(data.email) ? data.email[0] : data.email;
      } else if (data.username) {
        errorMsg = "Username already exists";
      } else if (data.detail) {
        errorMsg = data.detail;
      } else if (data.error) {
        errorMsg = data.error;
      }
      showMessage("signup-message", errorMsg, "error");
    }
  } catch (error) {
    console.error("Signup error:", error);
    showMessage(
      "signup-message",
      "Connection error. Please try again.",
      "error",
    );
  } finally {
    button.innerHTML = originalText;
    button.disabled = false;
  }
}

// Toggle password visibility
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const icon = btn.querySelector("i");

  if (input.type === "password") {
    input.type = "text";
    icon.className = "fa-solid fa-eye-slash";
  } else {
    input.type = "password";
    icon.className = "fa-solid fa-eye";
  }
}

// Check password match in real-time
function checkPasswordMatch() {
  const pwd1 = document.getElementById("signup-password").value;
  const pwd2 = document.getElementById("signup-password2").value;
  const hint = document.getElementById("pwd-match");

  if (!pwd2) {
    hint.textContent = "";
    hint.className = "pwd-match-hint";
    return;
  }

  if (pwd1 === pwd2) {
    hint.textContent = "✓ Passwords match";
    hint.className = "pwd-match-hint match";
  } else {
    hint.textContent = "✗ Passwords do not match";
    hint.className = "pwd-match-hint no-match";
  }
}
