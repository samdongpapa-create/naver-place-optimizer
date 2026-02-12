// API Base URL
const API_BASE = window.location.origin;

// 섹션 표시 함수
function showSection(sectionId) {
    const sections = ['inputSection', 'loadingSection', 'reportSection', 'errorSection'];
    sections.forEach(id => {
        document.getElementById(id).style.display = id === sectionId ? 'block' : 'none';
    });
}

// 오류 표시
function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    showSection('errorSection');
}

// 진단 초기화
function resetDiagnosis() {
    document.getElementById('placeUrl').value = '';
    document.getElementById('searchQuery').value = '';
    showSection('inputSection');
}

// 무료 진단
async function diagnoseFree() {
    const placeUrl = document.getElementById('placeUrl').value.trim();
    
    if (!placeUrl) {
        alert('플레이스 URL을 입력해주세요');
        return;
    }

    showSection('loadingSection');

    try {
        const response = await fetch(`${API_BASE}/api/diagnose/free`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ placeUrl })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || '진단 중 오류가 발생했습니다');
        }

        const result = await response.json();
        displayReport(result.data, false);

    } catch (error) {
        console.error('Error:', error);
        showError(error.message);
    }
}

// 유료 진단
async function diagnosePaid() {
    const placeUrl = document.getElementById('placeUrl').value.trim();
    const searchQuery = document.getElementById('searchQuery').value.trim();
    
    if (!placeUrl) {
        alert('플레이스 URL을 입력해주세요');
        return;
    }

    if (!confirm('유료 진단 (₩9,900)을 진행하시겠습니까?')) {
        return;
    }

    showSection('loadingSection');

    try {
        const response = await fetch(`${API_BASE}/api/diagnose/paid`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ placeUrl, searchQuery })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || '진단 중 오류가 발생했습니다');
        }

        const result = await response.json();
        displayReport(result.data, true);

    } catch (error) {
        console.error('Error:', error);
        showError(error.message);
    }
}

// 리포트 표시
function displayReport(data, isPaid) {
    // 플레이스 정보
    document.getElementById('placeName').textContent = data.placeData.name;
    document.getElementById('placeAddress').textContent = data.placeData.address;

    // 총점
    document.getElementById('totalScore').textContent = data.totalScore;
    document.getElementById('totalGrade').textContent = data.totalGrade;

    // 카테고리별 점수
    displayCategoryScores(data.scores, isPaid);

    // 유료 버전 - 개선안 표시
    if (isPaid && data.improvements) {
        displayImprovements(data.improvements);
        document.getElementById('improvementsSection').style.display = 'block';
    } else {
        // 무료 버전 - 블러 처리된 미리보기
        displayBlurredPreview();
    }

    // 유료 버전 - 경쟁사 분석 표시
    if (isPaid && data.competitors) {
        displayCompetitors(data.competitors, data.recommendedKeywords);
        document.getElementById('competitorsSection').style.display = 'block';
    }

    showSection('reportSection');
}

// 카테고리별 점수 표시
function displayCategoryScores(scores, isPaid) {
    const categoryScoresDiv = document.getElementById('categoryScores');
    categoryScoresDiv.innerHTML = '';

    const categories = [
        { key: 'description', icon: '📝', title: '상세설명' },
        { key: 'directions', icon: '🗺️', title: '오시는길' },
        { key: 'keywords', icon: '🔑', title: '대표키워드' },
        { key: 'reviews', icon: '⭐', title: '리뷰' },
        { key: 'photos', icon: '📸', title: '사진' }
    ];

    categories.forEach(cat => {
        const score = scores[cat.key];
        const card = document.createElement('div');
        card.className = 'category-card';
        
        const issuesList = score.issues.map(issue => `<li>${issue}</li>`).join('');
        
        card.innerHTML = `
            <div class="category-header">
                <div class="category-title">${cat.icon} ${cat.title}</div>
                <div class="category-score-badge">
                    <span class="score-number">${score.score}</span>
                    <span class="grade-badge grade-${score.grade}">${score.grade}</span>
                </div>
            </div>
            <ul class="category-issues">
                ${issuesList || '<li>문제 없음</li>'}
            </ul>
        `;
        
        categoryScoresDiv.appendChild(card);
    });
}

// 개선안 표시 (유료)
function displayImprovements(improvements) {
    const improvementsSection = document.getElementById('improvementsSection');
    improvementsSection.innerHTML = '<h3>📋 개선안</h3>';

    const improvementTypes = [
        { key: 'description', icon: '📝', title: '상세설명 개선안' },
        { key: 'directions', icon: '🗺️', title: '오시는길 개선안' },
        { key: 'reviewGuidance', icon: '⭐', title: '리뷰 개선 가이드' },
        { key: 'photoGuidance', icon: '📸', title: '사진 개선 가이드' }
    ];

    improvementTypes.forEach(type => {
        if (improvements[type.key]) {
            const card = document.createElement('div');
            card.className = 'improvement-card';
            
            const contentId = `improvement-${type.key}`;
            
            card.innerHTML = `
                <h3>${type.icon} ${type.title}</h3>
                <div class="improvement-content" id="${contentId}">${improvements[type.key]}</div>
                <button class="copy-button" onclick="copyToClipboard('${contentId}')">
                    📋 복사하기
                </button>
            `;
            
            improvementsSection.appendChild(card);
        }
    });

    // 추천 키워드 (배열인 경우)
    if (improvements.keywords && Array.isArray(improvements.keywords)) {
        const card = document.createElement('div');
        card.className = 'improvement-card';
        
        const keywordTags = improvements.keywords
            .map(kw => `<span class="keyword-tag">${kw}</span>`)
            .join('');
        
        card.innerHTML = `
            <h3>🔑 추천 대표키워드</h3>
            <div class="competitor-keywords">${keywordTags}</div>
        `;
        
        improvementsSection.appendChild(card);
    }
}

// 블러 처리된 미리보기 (무료)
function displayBlurredPreview() {
    const improvementsSection = document.getElementById('improvementsSection');
    improvementsSection.innerHTML = `
        <h3>📋 개선안</h3>
        <div class="blurred">
            <div class="improvement-card">
                <h3>📝 상세설명 개선안</h3>
                <div class="improvement-content">
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit...
                    Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
                    Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris...
                </div>
            </div>
            <div class="improvement-card">
                <h3>🗺️ 오시는길 개선안</h3>
                <div class="improvement-content">
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit...
                    Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
                </div>
            </div>
        </div>
        <div class="upgrade-overlay">
            <h4>🎯 전체 개선안을 확인하세요!</h4>
            <p>유료 진단에서 모든 항목의 상세한 개선안과 경쟁사 분석을 제공합니다</p>
            <button class="btn btn-primary" onclick="scrollToTop()">
                유료 진단 시작하기
            </button>
        </div>
    `;
    improvementsSection.style.display = 'block';
}

// 경쟁사 분석 표시 (유료)
function displayCompetitors(competitors, recommendedKeywords) {
    const competitorsSection = document.getElementById('competitorsSection');
    competitorsSection.innerHTML = '<h3>🏆 경쟁사 Top 5 분석</h3>';

    competitors.forEach((comp, index) => {
        const card = document.createElement('div');
        card.className = 'competitor-card';
        
        const keywordTags = comp.keywords
            .map(kw => `<span class="keyword-tag">${kw}</span>`)
            .join('');
        
        card.innerHTML = `
            <h4>${index + 1}. ${comp.name}</h4>
            <p>${comp.address}</p>
            <p>리뷰: ${comp.reviewCount}개 | 사진: ${comp.photoCount}개</p>
            <div class="competitor-keywords">${keywordTags}</div>
        `;
        
        competitorsSection.appendChild(card);
    });

    // 추천 키워드
    if (recommendedKeywords && recommendedKeywords.length > 0) {
        const recommendCard = document.createElement('div');
        recommendCard.className = 'improvement-card';
        recommendCard.style.marginTop = '20px';
        
        const keywordTags = recommendedKeywords
            .map(kw => `<span class="keyword-tag">${kw}</span>`)
            .join('');
        
        recommendCard.innerHTML = `
            <h3>💡 추천 키워드</h3>
            <p style="margin-bottom: 15px; color: #666;">경쟁사 분석을 바탕으로 한 추천 키워드입니다</p>
            <div class="competitor-keywords">${keywordTags}</div>
        `;
        
        competitorsSection.appendChild(recommendCard);
    }
}

// 클립보드 복사
function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    const text = element.textContent;
    
    navigator.clipboard.writeText(text).then(() => {
        alert('복사되었습니다! 네이버 플레이스에 붙여넣기 하세요.');
    }).catch(err => {
        console.error('복사 실패:', err);
        alert('복사에 실패했습니다. 다시 시도해주세요.');
    });
}

// 맨 위로 스크롤
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    showSection('inputSection');
});
