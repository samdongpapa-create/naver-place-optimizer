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

    if (count === 0) {
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

    if (count === 0) {
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

    return `${name}은(는) 고객 만족을 최우선으로 운영되는 매장입니다.

✨ 주요 특징
- 전문적인 시술/서비스 제공
- 트렌디한 분위기와 쾌적한 공간
- 재방문율이 높은 고객 만족도

📍 위치
- 접근성이 뛰어난 위치

⏰ 영업시간
- 평일 / 주말 정상 운영

📞 문의
- 네이버 예약 또는 전화 문의 가능

※ 상세설명은 200자 이상 작성 시 검색 노출 확률이 상승합니다.`;
  }

  private buildDirectionsImprovement(place: PlaceData): string {
    return `📍 지하철 이용 시
- 가까운 역에서 도보 이동 가능
- 출구 번호 및 도보 시간 명확히 작성 권장

🚌 버스 이용 시
- 인근 정류장명 기재
- 하차 후 도보 안내 추가

🚗 자가용 이용 시
- 건물명 또는 도로명 주소 기재
- 주차 가능 여부 반드시 명시

※ 오시는길은 구체적으로 작성할수록 전환율이 상승합니다.`;
  }

  private buildReviewGuide(place: PlaceData): string {
    return `1️⃣ 리뷰 유도 전략
- 방문 후 리뷰 작성 시 소정의 혜택 제공
- QR코드 활용
- 시술 전/후 사진 업로드 유도

2️⃣ 답글 전략
- 24시간 이내 답변
- 고객 이름 언급
- 키워드 자연 삽입

3️⃣ 목표
- 최소 50개 이상 확보 시 노출 안정화`;
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
