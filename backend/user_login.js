document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  if (!form) return;

  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    submitBtn.disabled = true;

    const { error } = await sb.auth.signInWithPassword({
      email: emailInput.value,
      password: passwordInput.value,
    });

    submitBtn.disabled = false;
    if (error) {
      errorEl.textContent = error.message;
      errorEl.classList.remove('hidden');
      return;
    }
    location.href = 'index.html';
  });
});
