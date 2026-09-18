const usernameInput = document.getElementById('identifier');
const passwordInput = document.getElementById('password');
const loginButton = document.querySelector(".btn");

if (usernameInput && passwordInput && loginButton) {
    usernameInput.addEventListener('input', toggleLoginButton);
    passwordInput.addEventListener('input', toggleLoginButton);
    toggleLoginButton();
}

function toggleLoginButton() {
    if (usernameInput.value.trim() !== '' && passwordInput.value.trim() !== '' && passwordInput.value.trim().length >= 6) {
        loginButton.removeAttribute('disabled');
    } else {
        loginButton.setAttribute('disabled', 'true');
    }
}
