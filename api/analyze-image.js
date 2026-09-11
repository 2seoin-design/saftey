const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MODEL = 'gemini-2.0-flash';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '14mb',
    },
  },
};

function parseModelResponse(text) {
  const jsonText = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  const result = JSON.parse(jsonText);

  if (
    typeof result.title !== 'string' ||
    typeof result.description !== 'string' ||
    typeof result.confidence !== 'number' ||
    typeof result.measurement !== 'string'
  ) {
    throw new Error('AI 분석 응답 형식이 올바르지 않습니다.');
  }

  return {
    title: result.title,
    description: result.description,
    confidence: Math.max(0, Math.min(100, result.confidence)),
    measurement: result.measurement,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  const { mimeType, data } = req.body || {};
  if (!mimeType?.startsWith('image/') || typeof data !== 'string') {
    return res.status(400).json({ error: '분석할 이미지 데이터가 필요합니다.' });
  }

  const imageBytes = Math.floor(data.length * 3 / 4);
  if (imageBytes > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: '사진은 10MB 이하만 분석할 수 있습니다.' });
  }

  const prompt = [
    '한국의 보행 안전 신고 앱에서 사용할 위험 요소 사진 분석을 수행하세요.',
    '사진에 보이는 위험 요소만 근거로 판단하고, 보이지 않는 수치나 위치를 지어내지 마세요.',
    '반드시 아래 JSON 형식만 반환하세요. 마크다운 코드 블록이나 추가 설명은 포함하지 마세요.',
    '{"title":"[AI 위험 감지] ...","description":"위험 요소와 보행자 주의사항","confidence":0,"measurement":"측정 가능한 경우에만 수치, 아니면 확인 필요"}',
    'confidence는 0부터 100 사이의 숫자이며, measurement는 사진만으로 측정할 수 없으면 "현장 확인 필요"로 작성하세요.',
  ].join('\n');

  try {
    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data } },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        }),
      }
    );

    const payload = await response.json();
    if (!response.ok) {
      return res.status(502).json({
        error: 'AI 분석 API 호출에 실패했습니다.',
        detail: payload?.error?.message || 'Gemini API 오류',
      });
    }

    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(502).json({ error: 'AI 분석 결과가 비어 있습니다.' });
    }

    return res.status(200).json(parseModelResponse(text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI 분석 결과를 해석하지 못했습니다.' });
    }
    return res.status(502).json({ error: 'AI 분석 중 오류가 발생했습니다.', detail: error.message });
  }
}
