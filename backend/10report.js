(async () => {
      const SUPABASE_URL = 'https://uaiokdnbzbvpmoqnvsho.supabase.co';
      const SUPABASE_KEY = 'sb_publishable_smBlW5ILkjZmAcYCi14K9A_LS4TktdR';
      const STATUS_VALUES = ['pending', 'reviewing', 'approved', 'rejected'];
      const MAX_PHOTO_SIZE = 10 * 1024 * 1024;

      const loadSupabase = () => {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
          return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Supabase 라이브러리를 불러오지 못했습니다.'));
          document.head.appendChild(script);
        });
      };

      await loadSupabase();
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      let reports = [];
      let channel;
      let photoPicker;

      const emit = (name, detail) => {
        window.dispatchEvent(new CustomEvent(name, { detail }));
      };

      const createPhotoPicker = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.hidden = true;
        document.body.appendChild(input);
        return input;
      };

      const openPhotoPicker = (mode = 'camera') => {
        if (!photoPicker) {
          photoPicker = createPhotoPicker();
          photoPicker.addEventListener('change', () => {
            const [file] = photoPicker.files || [];
            photoPicker.value = '';
            if (!file) {
              return;
            }
            if (!file.type.startsWith('image/')) {
              const error = new Error('이미지 파일만 선택할 수 있습니다.');
              emit('report:photo-error', error);
              return;
            }
            if (file.size > MAX_PHOTO_SIZE) {
              const error = new Error('사진은 10MB 이하만 업로드할 수 있습니다.');
              emit('report:photo-error', error);
              return;
            }
            emit('report:photo-selected', {
              file,
              previewUrl: URL.createObjectURL(file),
              source: mode
            });
          });
        }

        if (mode === 'camera') {
          photoPicker.setAttribute('capture', 'environment');
        } else {
          photoPicker.removeAttribute('capture');
        }
        photoPicker.click();
      };

      const uploadPhoto = async (file, reportId, bucket = 'report-images') => {
        if (!(file instanceof File) || !file.type.startsWith('image/')) {
          throw new Error('업로드할 이미지 파일이 없습니다.');
        }
        if (file.size > MAX_PHOTO_SIZE) {
          throw new Error('사진은 10MB 이하만 업로드할 수 있습니다.');
        }

        const extension = file.name.split('.').pop().toLowerCase() || 'jpg';
        const path = `${reportId || crypto.randomUUID()}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await client.storage
          .from(bucket)
          .upload(path, file, { contentType: file.type, upsert: false });

        if (uploadError) {
          emit('report:photo-error', uploadError);
          throw uploadError;
        }

        const { data } = client.storage.from(bucket).getPublicUrl(path);
        const result = { path, url: data.publicUrl, file };
        emit('report:photo-uploaded', result);
        return result;
      };

      const getReports = async (status = 'all') => {
        let query = client
          .from('reports')
          .select('*')
          .order('created_at', { ascending: false });

        if (status !== 'all') {
          if (!STATUS_VALUES.includes(status)) {
            throw new Error(`지원하지 않는 제보 상태입니다: ${status}`);
          }
          query = query.eq('status', status);
        }

        const { data, error } = await query;
        if (error) {
          emit('report:error', error);
          throw error;
        }

        reports = data || [];
        emit('reports:loaded', reports);
        return reports;
      };

      const updateReportStatus = async (id, status) => {
        if (!id) {
          throw new Error('상태를 변경할 제보 id가 없습니다.');
        }
        if (!STATUS_VALUES.includes(status) || status === 'pending') {
          throw new Error(`변경할 수 없는 제보 상태입니다: ${status}`);
        }

        const { data, error } = await client
          .from('reports')
          .update({ status })
          .eq('id', id)
          .select()
          .single();

        if (error) {
          emit('report:error', error);
          throw error;
        }

        const index = reports.findIndex((report) => report.id === id);
        if (index >= 0) {
          reports[index] = data;
        }
        emit('report:updated', data);
        return data;
      };

      const subscribeToReports = (onChange) => {
        if (channel) {
          channel.unsubscribe();
        }

        channel = client
          .channel('reports-backend')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'reports' },
            async (payload) => {
              emit('report:changed', payload);
              try {
                await getReports();
              } catch (error) {
                console.error('변경된 제보 데이터를 갱신하지 못했습니다:', error);
                return;
              }
              if (onChange) {
                onChange(payload, reports);
              }
            }
          )
          .subscribe();

        return channel;
      };

      const handleReportAction = async (event) => {
        const photoButton = event.target.closest('[data-report-camera], [data-report-upload]');
        if (photoButton) {
          openPhotoPicker(photoButton.hasAttribute('data-report-camera') ? 'camera' : 'upload');
          return;
        }

        const clickedButton = event.target.closest('button');
        const icon = clickedButton?.querySelector('.material-symbols-outlined')?.textContent.trim();
        if (icon === 'photo_camera' || icon === 'cameraswitch') {
          openPhotoPicker('camera');
          return;
        }
        if (icon === 'image') {
          openPhotoPicker('upload');
          return;
        }

        const button = event.target.closest('[data-report-id][data-status]');
        if (!button) {
          return;
        }

        button.disabled = true;
        try {
          await updateReportStatus(button.dataset.reportId, button.dataset.status);
        } finally {
          button.disabled = false;
        }
      };

      window.reportBackend = Object.freeze({
        client,
        getReports,
        updateReportStatus,
        subscribeToReports,
        openPhotoPicker,
        uploadPhoto,
        getCachedReports: () => reports.slice()
      });

      document.addEventListener('click', handleReportAction);
      subscribeToReports();
      getReports().catch((error) => {
        console.error('제보 데이터를 불러오지 못했습니다:', error);
      });
})();
