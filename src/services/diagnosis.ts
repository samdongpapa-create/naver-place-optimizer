import { PlaceData, ScoreResult, CategoryScores, DiagnosisReport } from '../types';

export class DiagnosisService {
  private scoreToGrade(score: number): 'S' | 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 95) return 'S';
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }

  evaluateDescription(description: string): ScoreResult {
    const issues: string[] = [];
    let score = 100;

    if (!description || description.length === 0) {
      issues.push('상세설명이 등록되지 않았습니다');
      score = 0;
    } else {
      if (description.length < 100) {
        issues.push('상세설명이 너무 짧습니다 (100자 이상 권장)');
        score -= 30;
      }
      if (description.length < 200) {
        issues.push('더 자세한 설명을 추가하면 좋습니다 (200자 이상 권장)');
        score -= 15;
      }
      if (!/영업시간|운영시간|오픈|가격|메뉴|서비스/.test(description)) {
        issues.push('영업시간, 가격, 주요 서비스 정보 추가 권장');
        score -= 20;
      }
    }

    score = Math.max(0, score);
    return { score, grade: this.scoreToGrade(score), issues };
  }

  evaluateDirections(directions: string): ScoreResult {
    const issues: string[] = [];
    let score = 100;

    if (!directions || directions.length === 0) {
      issues.push('오시는길 정보가 등록되지 않았습니다');
      score = 0;
    } else {
      if (directions.length < 50) {
        issues.push('오시는길 설명이 너무 짧습니다');
        score -= 30;
      }
      if (!/지하철|버스|도보|주차|출구/.test(directions)) {
        issues.push('대중교통 또는 주차 정보 추가 권장');
        score -= 25;
      }
    }

    score = Math.max(0, score);
    return { score, grade: this.scoreToGrade(score), issues };
  }

  evaluateKeywords(keywords: string[]): ScoreResult {
    const issues: string[] = [];
    let score = 100;

    if (!keywords || keywords.length === 0) {
      issues.push('대표키워드가 설정되지 않았습니다');
      score = 0;
    } else if (keywords.length < 3) {
      issues.push('대표키워드를 더 추가하세요 (3개 이상 권장)');
      score -= 40;
    } else if (keywords.length < 5) {
      issues.push('대표키워드를 5개까지 설정하는 것을 권장합니다');
      score -= 20;
    }

    score = Math.max(0, score);
    return { score, grade: this.scoreToGrade(score), issues };
  }

  evaluateReviews(reviewCount: number): ScoreResult {
    const issues: string[] = [];
    let score = 100;

    if (reviewCount === 0) {
      issues.push('리뷰가 없습니다. 고객 리뷰 유도가 필요합니다');
      score = 0;
    } else if (reviewCount < 10) {
      issues.push('리뷰가 부족합니다 (10개 이상 권장)');
      score = 30;
    } else if (reviewCount < 50) {
      issues.push('리뷰를 더 확보하면 좋습니다 (50개 이상 권장)');
      score = 60;
    } else if (reviewCount < 100) {
      issues.push('양호한 리뷰 수입니다');
      score = 80;
    }

    score = Math.max(0, score);
    return { score, grade: this.scoreToGrade(score), issues };
  }

  evaluatePhotos(photoCount: number): ScoreResult {
    const issues: string[] = [];
    let score = 100;

    if (photoCount === 0) {
      issues.push('사진이 없습니다. 매장 사진 등록이 필요합니다');
      score = 0;
    } else if (photoCount < 10) {
      issues.push('사진이 부족합니다 (10장 이상 권장)');
      score = 30;
    } else if (photoCount < 30) {
      issues.push('사진을 더 추가하면 좋습니다 (30장 이상 권장)');
      score = 60;
    } else if (photoCount < 50) {
      issues.push('양호한 사진 수입니다');
      score = 80;
    }

    score = Math.max(0, score);
    return { score, grade: this.scoreToGrade(score), issues };
  }

  generateDiagnosis(placeData: PlaceData, isPaid: boolean = false): DiagnosisReport {
    const scores: CategoryScores = {
      description: this.evaluateDescription(placeData.description),
      directions: this.evaluateDirections(placeData.directions),
      keywords: this.evaluateKeywords(placeData.keywords),
      reviews: this.evaluateReviews(placeData.reviewCount),
      photos: this.evaluatePhotos(placeData.photoCount)
    };

    const totalScore = Math.round(
      (scores.description.score +
        scores.directions.score +
        scores.keywords.score +
        scores.reviews.score +
        scores.photos.score) / 5
    );

    const report: DiagnosisReport = {
      placeData,
      scores,
      totalScore,
      totalGrade: this.scoreToGrade(totalScore),
      isPaid
    };

    if (isPaid) {
      report.improvements = this.generateImprovements(placeData, scores);
      report.recommendedKeywords = this.generateRecommendedKeywords(placeData);
    }

    return report;
  }

  private generateImprovements(placeData: PlaceData, scores: CategoryScores): any {
    const improvements: any = {};

    if (scores.description.score < 80) improvements.description = this.generateDescriptionImprovement(placeData);
    if (scores.directions.score < 80) improvements.directions = this.generateDirectionsImprovement(placeData);
    if (scores.keywords.score < 80) improvements.keywords = this.generateKeywordImprovements(placeData);

    if (scores.reviews.score < 80) improvements.reviewGuidance = this.generateReviewGuidance(placeData);
    if (scores.photos.score < 80) improvements.photoGuidance = this.generatePhotoGuidance(placeData);

    return improvements;
  }

  private generateDescriptionImprovement(placeData: PlaceData): string {
    return `✅ 상세설명 개선 템플릿\n\n- 매장/서비스 한 줄 소개\n- 주요 서비스 3가지\n- 가격/소요시간/예약 안내\n- 위치/접근성/주차 안내\n- 후기 유도 문구\n\n(현재 매장: ${placeData.name})`;
  }

  private generateDirectionsImprovement(placeData: PlaceData): string {
    return `✅ 오시는길 개선 템플릿\n\n- 지하철: (역/출구/도보 몇 분)\n- 버스: (정류장명)\n- 주차: (가능/불가, 무료/유료, 안내)\n- 건물/층/입구 팁\n\n(현재 매장: ${placeData.name})`;
  }

  private generateKeywordImprovements(placeData: PlaceData): string[] {
    const base = placeData.keywords || [];
    const suggestions = [
      ...base,
      `${placeData.name} 추천`,
      `${placeData.name} 후기`,
      `근처 미용실`,
      `예약 가능한`,
      `커트 잘하는곳`
    ];
    return Array.from(new Set(suggestions)).slice(0, 10);
  }

  private generateReviewGuidance(placeData: PlaceData): string {
    return `✅ 리뷰 유도 가이드\n\n- 시술/서비스 직후 간단한 QR 안내\n- \"오늘 스타일 만족하셨다면 사진+후기 부탁드려요\" 같은 자연스러운 멘트\n- 답글은 키워드 1~2개 포함(과하지 않게)\n\n(현재 리뷰: ${placeData.reviewCount}개)`;
  }

  private generatePhotoGuidance(placeData: PlaceData): string {
    return `✅ 사진 등록 가이드\n\n- 외관/입구/간판\n- 내부(대기공간/좌석)\n- 시술 전후(가능한 범위 내)\n- 스태프/제품/도구\n- 이벤트/프로모션\n\n(현재 사진: ${placeData.photoCount}장)`;
  }

  private generateRecommendedKeywords(placeData: PlaceData): string[] {
    const base = placeData.keywords || [];
    const out = [
      ...base,
      '서대문역 미용실',
      '커트',
      '염색',
      '펌',
      '두피클리닉'
    ];
    return Array.from(new Set(out)).slice(0, 10);
  }
}

// ✅ 호환용 alias
export class PlaceDiagnosisService extends DiagnosisService {}
