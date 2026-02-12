import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { NaverPlaceCrawler, Plan } from './services/enrichPlace';
import { DiagnosisService } from './services/diagnosis';
import { convertToMobileUrl, isValidPlaceUrl } from './utils/urlHelper';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Services
const crawler = new NaverPlaceCrawler();
const diagnosisService = new DiagnosisService();

function classifyIndustryFromUrl(mobileUrl: string): { vertical: string; subcategory: string } {
  const m = mobileUrl.match(/m\.place\.naver\.com\/(\w+)\//);
  const subcategory = m?.[1] || 'place';
  let vertical = 'other';
  if (subcategory.includes('hair') || subcategory.includes('beauty')) vertical = 'beauty';
  if (subcategory.includes('restaurant') || subcategory.includes('cafe') || subcategory.includes('food')) vertical = 'food';
  if (subcategory.includes('hotel') || subcategory.includes('accommodation')) vertical = 'travel';
  return { vertical, subcategory };
}

function applyPlan(report: any, plan: Plan) {
  if (plan === 'pro') return report;

  // free: 개선안/추천키워드/경쟁사 일부를 블랭크 처리
  if (report?.improvements) {
    if (report.improvements.description) report.improvements.description = '🔒 유료 리포트에서 전체 문구를 제공합니다';
    if (report.improvements.directions) report.improvements.directions = '🔒 유료 리포트에서 전체 문구를 제공합니다';
    if (Array.isArray(report.improvements.keywords) && report.improvements.keywords.length) {
      report.improvements.keywords = report.improvements.keywords.map(() => '🔒');
    }
    if (report.improvements.reviewGuidance) report.improvements.reviewGuidance = '🔒 유료 리포트에서 제공합니다';
    if (report.improvements.photoGuidance) report.improvements.photoGuidance = '🔒 유료 리포트에서 제공합니다';
  }
  if (Array.isArray(report?.recommendedKeywords) && report.recommendedKeywords.length) {
    report.recommendedKeywords = report.recommendedKeywords.map(() => '🔒');
  }
  if (Array.isArray(report?.competitors) && report.competitors.length) {
    report.competitors = report.competitors.map((c: any) => ({
      ...c,
      keywords: Array.isArray(c.keywords) ? c.keywords.map(() => '🔒') : []
    }));
  }
  return report;
}

// 서버 시작 시 브라우저 초기화
(async () => {
  try {
    await crawler.initialize();
    console.log('✅ Playwright 브라우저 초기화 완료');
  } catch (error) {
    console.error('❌ 브라우저 초기화 실패:', error);
  }
})();

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ✅ 통합 분석 API (권장)
// POST /api/analyze
// body: { input: { placeUrl }, options: { plan: 'free'|'pro', searchQuery? } }
app.post('/api/analyze', async (req: Request, res: Response) => {
  try {
    const placeUrl: string = req.body?.input?.placeUrl || req.body?.placeUrl;
    const plan: Plan = (req.body?.options?.plan || req.body?.plan || 'free') as Plan;
    const searchQuery: string | undefined = req.body?.options?.searchQuery || req.body?.searchQuery;

    if (!placeUrl) {
      return res.status(400).json({ error: '플레이스 URL을 입력해주세요' });
    }

    if (!isValidPlaceUrl(placeUrl)) {
      return res.status(400).json({
        error: '올바른 네이버 플레이스 URL을 입력해주세요',
        message: '예시: https://map.naver.com/p/entry/place/1234567890'
      });
    }

    const mobileUrl = convertToMobileUrl(placeUrl);

    console.log('🔍 분석 시작:', { plan, mobileUrl });
    const { place, debug } = await crawler.enrichPlace(mobileUrl);

    const isPaid = plan === 'pro';
    const diagnosisRaw = diagnosisService.generateDiagnosis(place, isPaid);

    // pro + searchQuery 있으면 경쟁사
    if (isPaid && searchQuery) {
      try {
        const competitors = await crawler.searchCompetitors(searchQuery, 5);
        diagnosisRaw.competitors = competitors;
      } catch (e) {
        console.error('경쟁사 분석 오류:', e);
      }
    }

    const diagnosis = applyPlan(diagnosisRaw, plan);
    const industry = classifyIndustryFromUrl(mobileUrl);

    return res.json({
      success: true,
      meta: {
        fetchedAt: new Date().toISOString(),
        plan,
        debug
      },
      industry,
      place: diagnosis.placeData,
      scores: diagnosis.scores,
      recommend: {
        totalScore: diagnosis.totalScore,
        totalGrade: diagnosis.totalGrade,
        improvements: diagnosis.improvements,
        recommendedKeywords: diagnosis.recommendedKeywords,
        competitors: diagnosis.competitors
      }
    });
  } catch (error: any) {
    console.error('❌ 분석 오류:', error);
    return res.status(500).json({
      error: '진단 중 오류가 발생했습니다.',
      message: error?.message || String(error)
    });
  }
});

// 무료 진단 API (레거시 유지)
app.post('/api/diagnose/free', async (req: Request, res: Response) => {
  try {
    let { placeUrl } = req.body;

    if (!placeUrl) return res.status(400).json({ error: '플레이스 URL을 입력해주세요' });
    if (!isValidPlaceUrl(placeUrl)) {
      return res.status(400).json({
        error: '올바른 네이버 플레이스 URL을 입력해주세요',
        message: '예시: https://map.naver.com/p/entry/place/1234567890'
      });
    }

    placeUrl = convertToMobileUrl(placeUrl);
    console.log('🔍 플레이스 정보 수집 시작(무료)...', placeUrl);

    const { place: placeData } = await crawler.enrichPlace(placeUrl);
    const diagnosis = applyPlan(diagnosisService.generateDiagnosis(placeData, false), 'free');

    return res.json({ success: true, data: diagnosis });
  } catch (error: any) {
    console.error('❌ 진단 오류:', error);
    return res.status(500).json({ error: '진단 중 오류가 발생했습니다', message: error?.message || String(error) });
  }
});

// 유료 진단 API (레거시 유지)
app.post('/api/diagnose/paid', async (req: Request, res: Response) => {
  try {
    let { placeUrl, searchQuery } = req.body;

    if (!placeUrl) return res.status(400).json({ error: '플레이스 URL을 입력해주세요' });
    if (!isValidPlaceUrl(placeUrl)) {
      return res.status(400).json({
        error: '올바른 네이버 플레이스 URL을 입력해주세요',
        message: '예시: https://map.naver.com/p/entry/place/1234567890'
      });
    }

    placeUrl = convertToMobileUrl(placeUrl);
    console.log('🔍 플레이스 정보 수집 시작(유료)...', placeUrl);

    const { place: placeData } = await crawler.enrichPlace(placeUrl);
    const diagnosis = diagnosisService.generateDiagnosis(placeData, true);

    if (searchQuery) {
      try {
        const competitors = await crawler.searchCompetitors(searchQuery, 5);
        diagnosis.competitors = competitors;
      } catch (e) {
        console.error('경쟁사 분석 오류:', e);
      }
    }

    return res.json({ success: true, data: diagnosis });
  } catch (error: any) {
    console.error('❌ 진단 오류:', error);
    return res.status(500).json({ error: '진단 중 오류가 발생했습니다', message: error?.message || String(error) });
  }
});

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM 수신, 종료 중...');
  await crawler.close();
  process.exit(0);
});
process.on('SIGINT', async () => {
  console.log('SIGINT 수신, 종료 중...');
  await crawler.close();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`🚀 서버 실행 중: http://localhost:${port}`);
  console.log(`📊 환경: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
