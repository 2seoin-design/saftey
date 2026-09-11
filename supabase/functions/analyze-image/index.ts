const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash';
const CATEGORY_DEFINITIONS = [
  ['road_damage', '보도·포트홀 파손'],
  ['streetlight', '가로등·조도 불량'],
  ['stairs', '계단·단차 턱'],
  ['obstruction', '불법 적치물·통행방해'],
  ['other', '기타 위험'],
] as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const parseModelResponse = (text: string) => {
  const result = JSON.parse(text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim());
  if (
    typeof result.category !== 'string'
    || !CATEGORY_DEFINITIONS.some(([id]) => id === result.category)
    || typeof result.title !== 'string'
    || typeof result.description !== 'string'
    || typeof result.confidence !== 'number'
    || typeof result.measurement !== 'string'
  ) {
    throw new Error('AI 분석 결과 형식이 올바르지 않습니다.');
  }
  return {
    category: result.category,
    title: result.title,
    description: result.description,
    confidence: Math.max(0, Math.min(100, result.confidence)),
    measurement: result.measurement,
    explanation: typeof result.explanation === 'string' ? result.explanation : result.description,
  };
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'POST 요청만 허용됩니다.' }, 405);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY')?.trim();
  if (!apiKey) {
    return json({ error: 'Supabase Function에 GEMINI_API_KEY secret이 설정되지 않았습니다.' }, 500);
  }

  const { mimeType, data } = await request.json().catch(() => ({}));
  if (typeof mimeType !== 'string' || !mimeType.startsWith('image/') || typeof data !== 'string') {
    return json({ error: '분석할 이미지 데이터가 필요합니다.' }, 400);
  }
  if (Math.floor(data.length * 3 / 4) > MAX_IMAGE_BYTES) {
    return json({ error: '사진은 10MB 이하만 분석할 수 있습니다.' }, 413);
  }

  const prompt = [
    '한국의 보행 안전 신고 앱에서 사용할 위험 요소 사진 분석을 수행하세요.',
    '사진에 보이는 위험 요소만 근거로 판단하세요.',
    '싱크홀, 도로 함몰, 큰 구멍, 포트홀, 보도 붕괴처럼 지면이 꺼지거나 파손된 경우 category는 반드시 "road_damage"로 지정하세요.',
    `category는 다음 중 하나여야 합니다: ${CATEGORY_DEFINITIONS.map(([id, label]) => `${id}(${label})`).join(', ')}`,
    '반드시 JSON만 반환하세요. confidence는 0부터 100 사이 숫자입니다.',
    '{"category":"road_damage","title":"[AI 위험 감지] ...","description":"위험 요소와 보행자 주의사항","confidence":0,"measurement":"현장 확인 필요","explanation":"판단 근거"}',
  ].join('\n');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
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
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      return json({
        error: 'Gemini API 호출에 실패했습니다.',
        detail: payload?.error?.message || 'Gemini API 오류',
      }, 502);
    }
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: 'AI 분석 결과가 비어 있습니다.' }, 502);
    return json(parseModelResponse(text));
  } catch (error) {
    return json({ error: 'AI 분석 중 오류가 발생했습니다.', detail: error instanceof Error ? error.message : String(error) }, 502);
  }
});
