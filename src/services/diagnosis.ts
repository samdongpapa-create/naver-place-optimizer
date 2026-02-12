import { PlaceData } from '../types';

export interface DiagnosisResult {
  totalScore: number;
  grade: string;

  detail: DiagnosisItem;
  directions: DiagnosisItem;
  keywords: DiagnosisItem;
  review: DiagnosisItem;
  photo: DiagnosisItem;

  // server.ts에서 나중에 diagnosis.competitors = [...] 로 대입함
  competitors: any[];

  // 무료/유료 모두 내려주되, 무료는 블랭크 처리
  improvements: ImprovementResult;
}

interface DiagnosisItem {
  score: number;
  grade: string;
  issues: string[];
}

interface ImprovementResult {
  descriptionImprovement: string;
  directionsImprovement: string;
  reviewGuide: string;
  recommendedKeywords: string[];
  competitorKeywordSuggestion: string[];
}

export class PlaceDiagnosisService {
  /**
   * ✅ server.ts 호환 시그니처:
   * generateDiagnosis(placeData, false|true)
   */
  generateDiagnosis(place: PlaceData, isPaid: boolean): DiagnosisResult {
    return this.diagnose(place, isPaid);
  }

  /**
   * 실제 진단 로직
   */
  private diagnose(place: PlaceData, isPaid: boolean): DiagnosisResult {
    const detail = this.evaluateDescription(place.description);
    const directions = this.evaluateDirections(place.directions);
    const keywords = this.evaluateKeywords(place.keywords);
    const review = this.evaluateReview(place.reviewCount);
    const photo = this.evaluatePhoto(place.photoCount);

    const totalScore = Math.round(
      (detail.score + directions.score + keywords.score + review.score + photo.score) / 5
    );

    const improvements = isPaid
      ? this.generatePaidImprovements(place)
      : this.generateFreePreviewImprovements(place);

    return {
      totalScore,
      grade: this.getGrade(totalScore),
      detail,
      directions,
      keywords,
      review,
      photo,
      competitors: [], // 유료 API에서 searchQuery 있을 때 server.ts가 채워 넣음
      improvements
    };
  }

  // =============================
  // 점수 로직
  // =============================

  private evaluateDescription(desc: string): DiagnosisItem {
    const length = (desc || '').trim().length;
    let score = 0;
    const issues: string[] = [];

    if (length === 0) {
      score = 0;
      issues.push('상세설명이 없습니다.');
    } else if (length < 80) {
      score = 40;
      issues.push('상세설명이 너무 짧습니다 (최소 150~200자 권장)');
    } else if (length < 160) {
      score = 65;
      issues.push('200자 이상으로 확장하면 검색/전환에 더 유리합니다.');
    } else if (length < 260) {
      score = 80;
      issues.push('핵심 키워드(지역/역명/업종/강점)를 더 자연스럽게 넣어보세요.');
    } else {
      score = 92;
    }

    return { score, grade: this.getGrade(score), issues };
  }

  private evaluateDirections(dir: string): DiagnosisItem {
    const length = (dir || '').trim().length;
    let score = 0;
    const issues: string[] = [];

    if (length === 0) {
      score = 0;
      issues.push('오시는길 정보가 없습니다.');
    } else if (length < 40) {
      score = 45;
      issues.push('출구/도보시간/랜드마크 등 구체 정보가 부족합니다.');
    } else if (length < 90) {
      score = 70;
      issues.push('주차/버스/도보 동선 정보를 더 명확히 적어보세요.');
    } else {
      score = 88;
    }

    return { score, grade: this.getGrade(score), issues };
  }

  private evaluateKeywords(keywords: string[]): DiagnosisItem {
    const count = (keywords || []).filter(Boolean).length;
    let score = 0;
    const issues: string[] = [];

    if (count === 0) {
      score = 0;
      issues.push('대표키워드가 비어있습니다.');
    } else if (count < 3) {
      score = 60;
      issues.push('대표키워드를 5개까지 채우는 것을 권장합니다.');
    } else if (count < 5) {
      score = 82;
      issues.push('대표키워드 5개를 모두 채우면 노출 안정성이 올라갑니다.');
    } else {
      score = 95;
    }

    return { score, grade: this.getGrade(score), issues };
  }

  private evaluateReview(count: number): DiagnosisItem {
    const c = Number.isFinite(count) ? count : 0;
    let score = 0;
    const issues: string[] = [];

    if (c === 0) {
      score = 0;
      issues.push('리뷰가 없습니다.');
    } else if (c < 10) {
      score = 45;
      issues.push('리뷰 10개 이상 확보를 권장합니다.');
    } else if (c < 50) {
      score = 72;
      issues.push('리뷰 50개 이상이면 노출이 더 안정적입니다.');
    } else if (c < 200) {
      score = 88;
    } else {
      score = 95;
    }

    return { score, grade: this.getGrade(score), issues };
  }

  private evaluatePhoto(count: number): DiagnosisItem {
    const c = Number.isFinite(count) ? count : 0;
    let score = 0;
    const issues: string[] = [];

    if (c === 0) {
      score = 0;
      issues.push('사진이 없습니다.');
    } else if (c < 10) {
      score = 60;
      issues.push('사진 10장 이상(외관/내부/시술/가격표/전후)을 권장합니다.');
    } else if (c < 30) {
      score = 78;
      issues.push('대표사진 퀄리티/구성을 개선하면 전환율이 올라갑니다.');
    } else {
      score = 90;
    }

    return { score, grade: this.getGrade(score), issues };
  }

  private getGrade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }

  // =============================
  // 개선안 생성
  // =============================

  private generatePaidImprovements(place: PlaceData): ImprovementResult {
    return {
      descriptionImprovement: this.buildDescriptionImprovement(place),
      directionsImprovement: this.buildDirectionsImprovement(place),
      reviewGuide: this.buildReviewGuide(place),
      recommendedKeywords: this.generateRecommendedKeywords(place),
      competitorKeywordSuggestion: this.generateCompetitorKeywordSuggestion(place)
    };
  }

  /**
   * 무료 버전: 유료 항목은 “미리보기/블랭크 처리”
   */
  private generateFreePreviewImprovements(place: PlaceData): ImprovementResult {
    const previewLine = '🔒 유료 리포트에서 제공됩니다.';

    // 무료에서도 추천키워드 “미리보기” 느낌으로 2개만 노출하고 나머지 블랭크 처리
    const rec = this.generateRecommendedKeywords(place);
    const previewKeywords = [
      rec[0] || previewLine,
      rec[1] || previewLine,
      '🔒',
      '🔒',
      '🔒'
    ];

    return {
      descriptionImprovement: previewLine,
      directionsImprovement: previewLine,
      reviewGuide: previewLine,
      recommendedKeywords: previewKeywords,
      competitorKeywordSuggestion: ['🔒', '🔒', '🔒', '🔒', '🔒']
    };
  }

  private buildDescriptionImprovement(place: PlaceData): string {
    const name = place.name || '매장';
    const address = (place.address || '').trim();

    // 너무 “헤어살롱”에 종속되지 않게 범용 템플릿으로 구성
    return `${name}은(는) 방문 고객이 “다시 찾고 싶은 경험”을 제공하는 것을 목표로 운영됩니다.

✅ 이런 점이 좋아요
- 서비스/시술 품질에 집중
- 편안한 분위기와 쾌적한 공간
- 예약/문의가 편리한 운영

📍 위치
- ${address || '접근성이 좋은 위치'}

💡 이용 팁
- 예약 시 원하는 스타일/요청사항을 미리 남겨주시면 더 만족스러운 결과에 도움이 됩니다.
- (키워드 예시) 지역/역명 + 업종/서비스 + 강점(전문/친절/1:1/가성비 등)

※ 상세설명은 200~350자 권장 + 핵심 키워드를 자연스럽게 2~3회 포함하는 것이 좋습니다.`;
  }

  private buildDirectionsImprovement(_: PlaceData): string {
    return `📍 지하철
- 역명/출구 번호 + 도보 시간(예: 4분) + 랜드마크(건물명/편의점/카페 등)

🚌 버스
- 하차 정류장명 + 도보 동선(횡단보도/골목 진입 등)

🚗 자차
- 도로명 주소 + 주차 가능 여부(유/무료) + 위치(지하/기계식/인근 유료주차장)

※ “숫자(도보 n분/출구 n번)”와 “기준점(랜드마크)”가 있으면 예약 전환이 크게 올라갑니다.`;
  }

  private buildReviewGuide(place: PlaceData): string {
    const name = place.name || '매장';
    const hasPhoto = (place.photoCount || 0) > 0;

    return `✅ 리뷰 늘리는 가장 쉬운 흐름(현장용)
1) 서비스 종료 직후: “오늘 괜찮으셨다면 리뷰 한 줄만 부탁드려요 😊”
2) 가능하면: “${hasPhoto ? '사진도 같이' : '사진까지 올려주시면'} 큰 도움이 됩니다!”

✅ 답글 템플릿(복붙)
- “소중한 리뷰 감사합니다 😊 다음 방문도 더 만족드리겠습니다. 좋은 하루 보내세요!”

🎯 목표
- 리뷰 50개 이상: 노출 안정화에 유리
- 사진 리뷰 비율 증가: 클릭/전환에 도움

(${name} 기준으로 문구를 더 맞추려면 유료 리포트에서 업종/고객층 톤으로 최적화합니다)`;
  }

  private generateRecommendedKeywords(place: PlaceData): string[] {
    const addr = (place.address || '').trim();
    const parts = addr.split(' ').filter(Boolean);

    const city = parts[0] || '';
    const district = parts[1] || '';
    const base = place.name ? place.name.split(' ')[0] : '';

    // undefined 방지 + “맛집” 같은 업종 불일치 단어 최소화
    const k1 = district ? `${district}추천` : city ? `${city}추천` : '지역추천';
    const k2 = district ? `${district}예약` : '예약가능';
    const k3 = city ? `${city}후기` : '후기좋은';
    const k4 = base ? `${base}전문` : '전문';
    const k5 = '친절한';

    return [k1, k2, k3, k4, k5];
  }

  private generateCompetitorKeywordSuggestion(place: PlaceData): string[] {
    // 경쟁사 키워드는 paid endpoint에서 competitors 분석 후 따로 넣을 수도 있지만,
    // 기본 fallback 제공
    const own = (place.keywords || []).filter(Boolean);
    const fallback = ['예약', '후기', '추천', '전문', '친절'];

    return Array.from(new Set([...own, ...fallback])).slice(0, 5);
  }
}

/**
 * ✅ 혹시 과거 코드가 DiagnosisService로 import하는 경우 대비
 */
export const DiagnosisService = PlaceDiagnosisService;
