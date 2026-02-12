// API Base URL
const API_BASE = window.location.origin;

// 현재 플레이스 URL 저장
let currentPlaceUrl = '';

// 섹션 표시 함수
function showSection(sectionId) {
    const sections = ['inputSection', 'loadingSection', 'reportSection', 'errorSection'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === sectionId ? 'block' : 'none';
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
    currentPlaceUrl = '';
    showSection('inputSection');
}

// 무료 진단
async function diagnoseFree() {
    const placeUrl = document.getElementById('placeUrl').value.trim();
    
    if (!placeUrl) {
        alert('플레이스 URL을 입력해주세요');
        return;
    }

    currentPlaceUrl = placeUrl;
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
            throw new Error(error.message || error.error || '진단 중 오류가 발생했습니다');
        }

        const result = await response.json();
        displayReport(result.data, false);

    } catch (error) {
        console.error('Error:', error);
        showError(error.message);
    }
}

// 유료 진단 모달 표시
function showPaidModal() {
    document.getElementById('paidModal').style.display = 'flex';
}

// 유료 진단 모달 닫기
function closePaidModal() {
    document.getElementById('paidModal').style.display = 'none';
}

// 유료 진단
async function diagnosePaid() {
    const searchQuery = document.getElementById('searchQuery').value.trim();
    
    if (!searchQuery) {
        alert('경쟁사 분석을 위한 검색어를 입력해주세요\n(예: 강남 카페, 이태원 맛집)');
        return;
    }

    if (!currentPlaceUrl) {
        alert('플레이스 URL이 없습니다. 다시 시도해주세요.');
        closePaidModal();
        resetDiagnosis();
        return;
    }

    closePaidModal();
    showSection('loadingSection');

    try {
        const response = await fetch(`${API_BASE}/api/diagnose/paid`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                placeUrl: currentPlaceUrl, 
                searchQuery 
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || error.error || '진단 중 오류가 발생했습니다');
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
    
    // 총점 배지 색상
    const gradeBadge = document.getElementById('totalGradeBadge');
    gradeBadge.className = `grade-badge grade-${data.totalGrade}`;

    // 카테고리별 점수
    displayCategoryScores(data.scores);

    // 무료 버전 - 업그레이드 섹션 표시
    if (!isPaid) {
        document.getElementById('upgradeSection').style.display = 'block';
        document.getElementById('improvementsSection').style.display = 'none';
        document.getElementById('competitorsSection').style.display = 'none';
    } else {
        // 유료 버전 - 개선안 및 경쟁사 분석 표시
        document.getElementById('upgradeSection').style.display = 'none';
        
        if (data.improvements) {
            displayImprovements(data.improvements);
            document.getElementById('improvementsSection').style.display = 'block';
        }
        
        if (data.competitors) {
            displayCompetitors(data.competitors, data.recommendedKeywords);
            document.getElementById('competitorsSection').style.display = 'block';
        }
    }

    showSection('reportSection');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 카테고리별 점수 표시
function displayCategoryScores(scores) {
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
        
        const issuesList = score.issues.length > 0 
            ? score.issues.map(issue => `<li>${issue}</li>`).join('')
            : '<li>문제가 발견되지 않았습니다 ✓</li>';
        
        card.innerHTML = `
            <div class="category-header">
                <div class="category-title">${cat.icon} ${cat.title}</div>
                <div class="category-score">
                    <span class="category-score-number">${score.score}</span>
                    <span class="category-grade grade-${score.grade}">${score.grade}</span>
                </div>
            </div>
            <ul class="category-issues">
                ${issuesList}
            </ul>
        `;
        
        categoryScoresDiv.appendChild(card);
    });
}

// 개선안 표시 (유료)
function displayImprovements(improvements) {
    const improvementsSection = document.getElementById('improvementsSection');
    improvementsSection.innerHTML = '<h3 class="section-title">💡 맞춤 개선안</h3>';

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

    // 추천 키워드
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

// 경쟁사 분석 표시 (유료)
function displayCompetitors(competitors, recommendedKeywords) {
    const competitorsSection = document.getElementById('competitorsSection');
    competitorsSection.innerHTML = '<h3 class="section-title">🏆 경쟁사 Top 5 분석</h3>';

    if (competitors && competitors.length > 0) {
        competitors.forEach((comp, index) => {
            const card = document.createElement('div');
            card.className = 'competitor-card';
            
            const keywordTags = comp.keywords && comp.keywords.length > 0
                ? comp.keywords.map(kw => `<span class="keyword-tag">${kw}</span>`).join('')
                : '<span style="color: #999;">키워드 없음</span>';
            
            card.innerHTML = `
                <h4>${index + 1}. ${comp.name}</h4>
                <p>${comp.address || '주소 정보 없음'}</p>
                <p style="font-size: 0.85rem; color: #999;">리뷰: ${comp.reviewCount}개 | 사진: ${comp.photoCount}개</p>
                <div class="competitor-keywords">${keywordTags}</div>
            `;
            
            competitorsSection.appendChild(card);
        });
    }

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
        alert('✅ 복사되었습니다!\n네이버 플레이스에 붙여넣기 하세요.');
    }).catch(err => {
        console.error('복사 실패:', err);
        
        // Fallback: 텍스트 선택
        const range = document.createRange();
        range.selectNode(element);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        
        try {
            document.execCommand('copy');
            alert('✅ 복사되었습니다!');
        } catch (e) {
            alert('❌ 복사에 실패했습니다. 수동으로 복사해주세요.');
        }
        
        window.getSelection().removeAllRanges();
    });
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    showSection('inputSection');
    
    // Enter 키 이벤트
    document.getElementById('placeUrl').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            diagnoseFree();
        }
    });
    
    document.getElementById('searchQuery').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            diagnosePaid();
        }
    });
    
    // 모달 외부 클릭 시 닫기
    document.getElementById('paidModal').addEventListener('click', (e) => {
        if (e.target.id === 'paidModal') {
            closePaidModal();
        }
    });
});
