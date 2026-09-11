document.addEventListener('DOMContentLoaded', () => {
  const btnSubmit = document.getElementById('btn-submit');
  if (!btnSubmit) return;

  const btnCheckDup = document.getElementById('btn-check-dup');
  const dupFeedback = document.getElementById('dup-feedback');
  const errorEl = document.getElementById('signup-error');
  const emailInput = document.getElementById('email');
  const avatarInput = document.getElementById('signup-avatar-input');

  function readAvatarAsDataUrl() {
    const file = avatarInput?.files[0];
    if (!file) return Promise.resolve(null);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  // 마지막으로 중복확인을 통과한 이메일 (제출 시점에 이메일이 바뀌었으면 재확인 필요)
  let dupCheckedEmail = null;

  async function checkDuplicate(email) {
    const { data: exists, error } = await sb.rpc('email_exists', { check_email: email });
    if (error) throw error;
    return exists;
  }

  if (btnCheckDup) {
    btnCheckDup.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      if (!email) {
        dupFeedback.textContent = '이메일을 먼저 입력해주세요.';
        dupFeedback.classList.remove('hidden');
        return;
      }

      btnCheckDup.disabled = true;
      try {
        const exists = await checkDuplicate(email);
        dupFeedback.textContent = exists ? '이미 가입된 이메일입니다.' : '사용 가능한 이메일입니다.';
        dupFeedback.classList.remove('hidden', 'text-secondary', 'text-error');
        dupFeedback.classList.add(exists ? 'text-error' : 'text-secondary');
        dupCheckedEmail = exists ? null : email;
      } catch (err) {
        dupFeedback.textContent = '중복 확인 중 오류가 발생했습니다.';
        dupFeedback.classList.remove('hidden', 'text-secondary');
        dupFeedback.classList.add('text-error');
      } finally {
        btnCheckDup.disabled = false;
      }
    });
  }

  btnSubmit.addEventListener('click', async () => {
    errorEl.classList.add('hidden');

    const name = document.getElementById('name').value.trim();
    const email = emailInput.value.trim();
    const password = document.getElementById('password').value;
    const passwordConfirm = document.getElementById('password-confirm').value;

    if (!name || !email || !password) {
      errorEl.textContent = '이름, 이메일, 비밀번호를 모두 입력해주세요.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (password !== passwordConfirm) {
      errorEl.textContent = '비밀번호가 일치하지 않습니다.';
      errorEl.classList.remove('hidden');
      return;
    }

    btnSubmit.disabled = true;

    // 중복확인 버튼을 안 눌렀거나 이메일을 바꿨으면 제출 직전에 다시 확인
    if (dupCheckedEmail !== email) {
      try {
        const exists = await checkDuplicate(email);
        if (exists) {
          errorEl.textContent = '이미 가입된 이메일입니다.';
          errorEl.classList.remove('hidden');
          btnSubmit.disabled = false;
          return;
        }
      } catch (err) {
        errorEl.textContent = '중복 확인 중 오류가 발생했습니다.';
        errorEl.classList.remove('hidden');
        btnSubmit.disabled = false;
        return;
      }
    }

    const avatarDataUrl = await readAvatarAsDataUrl();
    const { error } = await sb.auth.signUp({
      email,
      password,
      options: { data: avatarDataUrl ? { name, avatar_url: avatarDataUrl } : { name } },
    });

    if (error) {
      btnSubmit.disabled = false;
      errorEl.textContent = error.message;
      errorEl.classList.remove('hidden');
      return;
    }

    // 이메일 인증이 꺼져 있으면 signUp이 세션을 만들어 자동 로그인시키므로,
    // 그 세션을 즉시 로그아웃시켜서 반드시 직접 로그인하도록 함
    await sb.auth.signOut();
    btnSubmit.disabled = false;
    // 완료 토스트와 함께 로그인 화면으로 이동
    location.href = 'login.html?signup=success';
  });
});
