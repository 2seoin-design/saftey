document.addEventListener('DOMContentLoaded', () => {
  const btnLogout = document.getElementById('btn-logout');
  if (!btnLogout) return;

  btnLogout.addEventListener('click', async () => {
    await sb.auth.signOut();
    location.href = 'login.html';
  });
});
