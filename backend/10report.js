(async () => {
      const SUPABASE_URL = 'https://gaicuiithjllwillleyo.supabase.co';
      const SUPABASE_KEY = 'sb_publishable_N5Cb72wbtKj-HhjIoZ20Aw_XBDlvTsy';
      const STATUS_VALUES = ['pending', 'reviewing', 'approved', 'rejected'];
      const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
      const GEMINI_API_KEY = window.GEMINI_API_KEY || '';
      const GEMINI_MODEL = 'gemini-2.0-flash';
      const AI_CLASSIFIER_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
      const AI_CLASSIFICATION_TIMEOUT = 30000;
      const AI_CATEGORY_DEFINITIONS = Object.freeze([
        {
          id: 'road_damage',
          label: '보도·포트홀 파손',
          reportType: 'HAZARD',
          aliases: ['road_damage', 'road damage', 'pothole', '보도 파손', '포트홀', '보도·포트홀 파손']
        },
        {
          id: 'streetlight',
          label: '가로등·조도 불량',
          reportType: 'HAZARD',
          aliases: ['streetlight', 'street light', 'lighting', '가로등', '조도 불량', '가로등·조도 불량']
        },
        {
          id: 'stairs',
          label: '계단·단차 턱',
          reportType: 'STAIRS',
          aliases: ['stairs', 'step', 'curb', '계단', '단차', '턱', '계단·단차 턱']
        },
        {
          id: 'obstruction',
          label: '불법 적치물·통행방해',
          reportType: 'CONSTR',
          aliases: ['obstruction', 'blocked', 'blocking', 'illegal dumping', '적치물', '통행방해', '불법 적치물·통행방해']
        },
        {
          id: 'other',
          label: '기타 위험',
          reportType: 'HAZARD',
          aliases: ['other', 'unknown', '기타', '기타 위험']
        }
      ]);

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
      let selectedPhoto;
      let selectedPhotoClassification;
      let photoClassificationPromise;
      let photoSelectionId = 0;

      const emit = (name, detail) => {
        window.dispatchEvent(new CustomEvent(name, { detail }));
      };

      const createPhotoPicker = () => {
        const existingInput = document.getElementById('albumInput');
        if (existingInput) {
          return existingInput;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.hidden = true;
        document.body.appendChild(input);
        return input;
      };

      const normalizeCategoryText = (value) => String(value || '')
        .trim()
        .toLocaleLowerCase('ko-KR')
        .replace(/[\s_-]+/g, '');

      const normalizeClassification = (classification) => {
        if (!classification || typeof classification !== 'object') {
          throw new Error('AI 분류 응답이 올바른 객체가 아닙니다.');
        }

        const categoryValue = classification.category
          || classification.categoryId
          || classification.label
          || classification.class;
        const normalizedValue = normalizeCategoryText(categoryValue);
        const category = AI_CATEGORY_DEFINITIONS.find((definition) => (
          normalizeCategoryText(definition.id) === normalizedValue
          || normalizeCategoryText(definition.label) === normalizedValue
          || definition.aliases.some((alias) => normalizeCategoryText(alias) === normalizedValue)
        ));

        if (!category) {
          throw new Error(`AI가 지원하지 않는 위험 유형을 반환했습니다: ${categoryValue || '없음'}`);
        }

        const rawConfidence = Number(classification.confidence);
        const confidence = Number.isFinite(rawConfidence)
          ? Math.max(0, Math.min(1, rawConfidence > 1 ? rawConfidence / 100 : rawConfidence))
          : null;

        return {
          categoryId: category.id,
          category: category.label,
          reportType: category.reportType,
          confidence,
          explanation: String(
            classification.explanation
            || classification.reason
            || classification.description
            || ''
          ).trim()
        };
      };

      const applyClassificationToUi = (classification) => {
        const chips = Array.from(document.querySelectorAll('.hazard-chip'));
        const targetChip = chips.find((chip) => chip.textContent.includes(classification.category));
        if (!targetChip) {
          return;
        }

        chips.forEach((chip) => {
          if (chip !== targetChip && chip.classList.contains('bg-[#60C219]')) {
            chip.click();
          }
        });
        if (!targetChip.classList.contains('bg-[#60C219]')) {
          targetChip.click();
        }
      };

      const parseClassificationResponse = (payload) => {
        if (payload && typeof payload === 'object') {
          const directResult = payload.classification || payload.result || payload;
          if (directResult && typeof directResult === 'object' && (
            directResult.category
            || directResult.categoryId
            || directResult.label
            || directResult.class
          )) {
            return directResult;
          }

          const modelText = payload.candidates?.[0]?.content?.parts
            ?.map((part) => part.text || '')
            .join('')
            .trim();
          if (modelText) {
            const jsonText = modelText.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
            try {
              return JSON.parse(jsonText);
            } catch (error) {
              const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
              }
              throw new Error('AI 응답에서 JSON 형식의 분류 결과를 찾지 못했습니다.');
            }
          }
        }

        throw new Error('AI 분류 응답에 위험 유형이 없습니다.');
      };

      const fileToBase64 = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const commaIndex = result.indexOf(',');
          if (commaIndex < 0) {
            reject(new Error('사진 데이터를 읽지 못했습니다.'));
            return;
          }
          resolve(result.slice(commaIndex + 1));
        };
        reader.onerror = () => reject(new Error('사진 데이터를 읽지 못했습니다.'));
        reader.readAsDataURL(file);
      });

      const classifyPhoto = async (file) => {
        if (!(file instanceof File) || !file.type.startsWith('image/')) {
          throw new Error('AI 분석을 진행할 이미지 파일이 없습니다.');
        }
        if (!GEMINI_API_KEY || GEMINI_API_KEY === 'PASTE_YOUR_GEMINI_API_KEY_HERE') {
          throw new Error('10report.js 상단의 GEMINI_API_KEY에 Gemini API 키를 입력해주세요.');
        }

        emit('report:ai-classification-started', { file });
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), AI_CLASSIFICATION_TIMEOUT);
        try {
          const response = await fetch(
            `${AI_CLASSIFIER_ENDPOINT}?key=${encodeURIComponent(GEMINI_API_KEY)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType: file.type,
                        data: await fileToBase64(file)
                      }
                    },
                    {
                      text: [
                        '이 사진에 찍힌 보행 안전 위험을 아래 5개 카테고리 중 정확히 하나로 분류하세요.',
                        ...AI_CATEGORY_DEFINITIONS.map(({ id, label }) => `- ${id}: ${label}`),
                        '사진에 위험 요소가 명확하지 않으면 other를 선택하세요.',
                        '응답은 JSON 형식만 반환하세요. confidence는 0부터 1 사이 숫자입니다.',
                        'explanation은 한국어로 짧게 작성하세요.'
                      ].join('\n')
                    }
                  ]
                }],
                generationConfig: {
                  temperature: 0,
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: 'OBJECT',
                    properties: {
                      category: {
                        type: 'STRING',
                        enum: AI_CATEGORY_DEFINITIONS.map(({ id }) => id)
                      },
                      confidence: { type: 'NUMBER' },
                      explanation: { type: 'STRING' }
                    },
                    required: ['category', 'confidence', 'explanation']
                  }
                }
              }),
              signal: controller.signal
            }
          );

          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            const message = payload?.error?.message || payload?.message
              || `AI 분류 서버가 ${response.status} 상태를 반환했습니다.`;
            throw new Error(message);
          }

          return normalizeClassification(parseClassificationResponse(payload));
        } catch (error) {
          if (error.name === 'AbortError') {
            throw new Error('AI 사진 분석 시간이 초과되었습니다.');
          }
          throw error;
        } finally {
          window.clearTimeout(timeoutId);
        }
      };

      const startPhotoClassification = (file) => {
        const currentSelectionId = ++photoSelectionId;
        selectedPhotoClassification = undefined;
        photoClassificationPromise = classifyPhoto(file)
          .then((classification) => {
            if (currentSelectionId === photoSelectionId) {
              selectedPhotoClassification = classification;
              applyClassificationToUi(classification);
              emit('report:ai-classified', { file, classification });
            }
            return classification;
          })
          .catch((error) => {
            if (currentSelectionId === photoSelectionId) {
              emit('report:ai-classification-error', { file, error });
            }
            return null;
          });
        return photoClassificationPromise;
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
            selectedPhoto = file;
            startPhotoClassification(file);
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

      const getCurrentPosition = () => new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('이 브라우저에서는 위치 정보를 사용할 수 없습니다.'));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => resolve(coords),
          (error) => reject(new Error(
            error.code === error.PERMISSION_DENIED
              ? '제보를 저장하려면 브라우저의 위치 정보 권한을 허용해주세요.'
              : '현재 위치를 확인하지 못했습니다.'
          )),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
      });

      const showCurrentLocation = ({ latitude, longitude, accuracy }) => {
        const locationIcon = Array.from(document.querySelectorAll('.material-symbols-outlined'))
          .find((element) => element.textContent.trim() === 'location_on');
        const locationText = locationIcon?.parentElement?.querySelector('span:not(.material-symbols-outlined)');
        if (locationText) {
          locationText.textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        }
        const accuracyText = locationText?.parentElement?.parentElement?.querySelector('span:last-child');
        if (accuracyText && Number.isFinite(accuracy)) {
          accuracyText.textContent = `GPS 오차 ±${Math.round(accuracy)}m`;
        }
        emit('report:location-updated', { latitude, longitude, accuracy });
      };

      const getSelectedReportType = () => {
        const activeChip = Array.from(document.querySelectorAll('.hazard-chip'))
          .find((chip) => chip.classList.contains('bg-[#60C219]'));
        const icon = activeChip?.querySelector('.material-symbols-outlined')?.textContent.trim();
        return {
          lightbulb: 'CONSTR',
          stairs: 'STAIRS',
          block: 'HAZARD',
          more_horiz: 'SAFE'
        }[icon] || 'HAZARD';
      };

      const createReport = async ({
        lat,
        lng,
        reportType,
        description = '',
        photo,
        aiClassification
      } = {}) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          throw new Error('제보 위치가 올바르지 않습니다.');
        }

        let classification = aiClassification;
        if (photo && !classification) {
          classification = photo === selectedPhoto && photoClassificationPromise
            ? await photoClassificationPromise
            : await classifyPhoto(photo);
          if (!classification) {
            throw new Error('사진 AI 분석에 실패했습니다. 사진을 다시 선택해주세요.');
          }
        }

        const { data: { user } } = await client.auth.getUser();
        if (!user) {
          throw new Error('제보를 저장하려면 먼저 로그인해주세요.');
        }
        const aiDescription = classification
          ? `[AI 분류: ${classification.category}]${classification.explanation ? ` ${classification.explanation}` : ''}`
          : '';
        const finalDescription = [aiDescription, description.trim()]
          .filter(Boolean)
          .join('\n');
        const { data, error } = await client
          .from('reports')
          .insert([{
            user_id: user?.id || null,
            report_type: reportType || classification?.reportType || getSelectedReportType(),
            description: finalDescription,
            location: `POINT(${lng} ${lat})`
          }])
          .select()
          .single();

        if (error) {
          emit('report:error', error);
          throw error;
        }

        let photoResult;
        if (photo) {
          try {
            photoResult = await uploadPhoto(photo, data.id);
            const { data: updatedReport, error: photoUrlError } = await client
              .from('reports')
              .update({ photo_url: photoResult.url })
              .eq('id', data.id)
              .select()
              .single();
            if (photoUrlError) {
              emit('report:error', photoUrlError);
              throw photoUrlError;
            }
            data.photo_url = updatedReport.photo_url;
          } catch (uploadError) {
            emit('report:photo-error', uploadError);
            throw uploadError;
          }
        }
        emit('report:created', { report: data, photo: photoResult, classification });
        return { report: data, photo: photoResult, classification };
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

        if (clickedButton?.id === 'submitReportBtn') {
          clickedButton.disabled = true;
          try {
            const position = await getCurrentPosition();
            showCurrentLocation(position);
            const description = document.querySelector('textarea')?.value || '';
            await createReport({
              lat: position.latitude,
              lng: position.longitude,
              description,
              photo: selectedPhoto,
              aiClassification: selectedPhotoClassification
            });
          } catch (error) {
            emit('report:error', error);
            console.error('제보 저장에 실패했습니다:', error);
          } finally {
            clickedButton.disabled = false;
          }
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
        createReport,
        getCurrentPosition,
        updateReportStatus,
        subscribeToReports,
        openPhotoPicker,
        uploadPhoto,
        classifyPhoto,
        getCachedReports: () => reports.slice()
      });

      document.addEventListener('click', handleReportAction);
      subscribeToReports();
      getReports().catch((error) => {
        console.error('제보 데이터를 불러오지 못했습니다:', error);
      });
})();
