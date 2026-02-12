import { PlaceData } from '../types';

export interface DiagnosisResult {
  totalScore: number;
  grade: string;
  detail: DiagnosisItem;
  directions: DiagnosisItem;
  keywords: DiagnosisItem;
  review: DiagnosisItem;
  photo: DiagnosisItem;
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
   * ✅ 기존 코드 호환용 메서드 (server.ts가 generateDiagnosis를 호출하는 경우)
   */
  generateDiagnosis(place: PlaceData): DiagnosisResult {
    return this.diagnose(place);
  }

  /**
   * 신규 표준 진단 메서드
   */
  diagnose(place: PlaceData): DiagnosisResult {
    const detail = this.evaluateDescription(place.description);
    const directions = this.evaluateDirections(place.directions);
    const keywords = this.evaluateKeywords(place.keywords);
    const review = this.evaluateReview(place.reviewCount);
    const photo = this.evaluatePhoto(place.photoCount);

    const totalScore = Math.round(
      (detail.score + directions.score + keywords.score + review.score + photo.score) / 5
    );

    return {
      totalScore,
      grade: this.getGrade(totalScore),
      detail,
      directions,
      keywords,
      review,
      photo,
      improvements: this.generateImprovements(place)
    };
  }

  // =============================
  // 점수 로직
  // =============================

  private evaluateDescription(desc: string): DiagnosisItem {
    const length = (desc || '').length;
    let score = 0;
    const issues: string[] = [];

    if (length === 0) {
      score = 0;
      issues.push('상세설명이 없습니다.');
    } else if (length < 100) {
      score = 35;
      issues.push('상세설명이 너무 짧습니다 (100자 이상 권장)');
    } else if (length < 200) {
      score = 65;
      issues.push('200자 이상 작성 시 노출 확률 상승');
    } else {
      score = 90;
    }

    return { score, grade: this.getGrade(score), issues };
  }

  private evaluateDirections(dir: string): DiagnosisItem {
    const length = (dir || '').length;
    let score = 0;
    const issues: string[] = [];

    if (length === 0) {
      score = 0;
      issues.push('오시는길 정보가 없습니다.');
    } else if (length < 50) {
      score = 50;
      issues.push('오시는길 설명이 부족합니다.');
    } else {
      score = 85;
    }

    return { score, grade: this.getGrade(score), issues };
  }

  private evaluateKeywords(keywords: string[]): DiagnosisItem {
    const count = keywords?.length || 0;
    let score = 0;
    const issues: string[] = [];

    if (count === 0) {
      score = 0;
      issues.push('대표키워드가 설정되지 않았습니다.');
    } else if (count < 3) {
      score = 60;
      issues.push('대표키워드를 5개 모두 채우는 것을 권장합니다.');
    } else {
      score = 95;
    }

    return { score, grade: this.getGrade(score), issues };
  }

  private evaluateReview(count: number): DiagnosisItem {
    let score = 0;
    const issues: string[] = [];

    if (!count || count === 0) {
      score = 0;
      issues.push('리뷰가 없습니다.');
    } else if (count < 10) {
      score = 40;
      issues.push('리뷰 10개 이상 권장');
    } else if (count < 50) {
      score = 70;
    } else {
      score = 95;
    }

    return { score, grade: this.getGrade(score), issues };
  }

  private evaluatePhoto(count: number): DiagnosisItem {
    let score = 0;
    const issues: string[] = [];

    if (!count || count === 0) {
      score = 0;
      issues.push('사진이 없습니다.');
    } else if (count < 10) {
      score = 60;
      issues.push('매장 사진 10장 이상 권장');
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
  // 개선안 생성 로직
  // =============================

  private generateImprovements(place: PlaceData): ImprovementResult {
    return {
      descriptionImprovement: this.buildDescriptionImprovement(place),
      directionsImprovement: this.buildDirectionsImprovement(place),
      reviewGuide: this.buildReviewGuide(place),
      recommendedKeywords: this.generateRecommendedKeywords(place),
      competitorKeywordSuggestion: this.generateCompetitorKeywordSuggestion(place)
    };
  }

  private buildDescriptionImprovement(place: PlaceData): string {
    const name = place.name || '매장';
    const address = (place.address || '').trim();

    return `${name}은(는) 고객 만족을 최우선으로 운영되는 매장입니다.

✨ 주요 특징
- 전문적인 서비스 제공
- 쾌적한 공간과 편안한 분위기
- 재방문율이 높은 만족도

📍 위치 안내
- ${address ? address : '접근성이 좋은 위치'}

📌 이용 안내
- 네이버 예약/문의 가능
- 방문 전 원하는 스타일/요청사항을 미리 남겨주시면 더 만족스러운 이용이 가능합니다.

※ 상세설명은 200자 이상 작성하고, “지역/역명 + 업종/서비스” 키워드를 자연스럽게 포함하면 노출에 도움이 됩니다.`;
  }

  private buildDirectionsImprovement(place: PlaceData): string {
    return `📍 지하철 이용 시
- 가까운 역/출구 기준으로 도보 시간(예: 3~7분)을 명확히 작성

🚌 버스 이용 시
- 인근 정류장명 + 하차 후 도보 안내 추가

🚗 자가용 이용 시
- 도로명 주소 + 건물명
- 주차 가능/불가, 유료/무료, 주차 위치(지하/기계식 등) 명시

※ 오시는길은 “숫자/기준점(출구, 정류장, 건물명)”이 들어갈수록 예약 전환율이 확 올라갑니다.`;
  }

  private buildReviewGuide(place: PlaceData): string {
    return `1️⃣ 리뷰 유도(현장 멘트)
- “오늘 만족하셨다면 리뷰 한 줄만 부탁드려요! 사진까지 올려주시면 더 큰 도움이 돼요 😊”

2️⃣ 리뷰 요청 타이밍
- 결제 직후 + 시술 직후(거울 확인 후) 2번 중 1번만 선택

3️⃣ 답글 템플릿
- “소중한 리뷰 감사합니다 😊 다음 방문에도 더 만족드리겠습니다!”

4️⃣ 목표
- 리뷰 50개 이상 → 노출 안정화에 유리`;
  }

  private generateRecommendedKeywords(place: PlaceData): string[] {
    const addr = (place.address || '').trim();
    const parts = addr.split(' ').filter(Boolean);

    const city = parts[0] || '';
    const district = parts[1] || '';

    return [
      city ? `${city}맛집` : '지역맛집',
      district ? `${district}핫플` : '핫플',
      '인스타감성',
      '데이트코스',
      '분위기좋은'
    ];
  }

  private generateCompetitorKeywordSuggestion(place: PlaceData): string[] {
    if (place.keywords && place.keywords.length > 0) {
      return place.keywords.slice(0, 5);
    }

    return ['맛집', '추천', '인기', '핫플', '가성비'];
  }
}

/**
 * ✅ 예전 코드 호환용 export (혹시 server.ts가 DiagnosisService를 import하는 경우 대비)
 */
export const DiagnosisService = PlaceDiagnosisService;
