// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// 대량 멀티 의뢰서 관리를 위한 전역 마스터 상태 변수
let allOrders = [];         // PDF에서 추출한 의뢰서 전체 목록
let filteredOrders = [];    // 검색어가 적용된 의뢰서 목록
let targetModels = [];      // 현재 화면에 띄워진 의뢰서의 완제품 모델명 대조군

let currentOrderIndex = 0;  // 현재 화면에 보여지고 있는 의뢰서의 번호 (0부터 시작)

// ==========================================
// 1. [최종 해결] CrystalViewer 대용량 PDF 전용 초정밀 파싱 로직
// ==========================================
document.getElementById("pdfFile").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const orderList = document.getElementById("orderList");
    orderList.innerHTML = "<li style='list-style:none; color:#2563eb; font-weight:bold;'>📄 [대량 문서 연산 중] 의뢰서 구조 분석 및 한글 매핑을 진행하고 있습니다... (잠시만 기다려 주세요)</li>";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            // 대량 문서 처리 시 튕김 방지 및 한글 깨짐용 필수 맵 사양 추가
            const loadingTask = pdfjsLib.getDocument({
                data: typedarray,
                cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/cmaps/',
                cMapPacked: true
            });
            
            const pdf = await loadingTask.promise;
            const totalPdfPages = pdf.numPages; 
            
            allOrders = []; // 마스터 데이터 초기화

            // 🔄 각 페이지(의뢰서 1장 단위) 순차적 정밀 루프 실행
            for (let pageNum = 1; pageNum <= totalPdfPages; pageNum++) {
                try {
                    const page = await pdf.getPage(pageNum);
                    const textData = await page.getTextContent();
                    
                    // 💡 [버그 수정 핵심] 큰따옴표, 따옴표, 줄바꿈, 탭, 슬래시 등의 모든 찌꺼기 기호를 완벽하게 공백 처리
                    const textItems = textData.items.map(item => {
                        if (!item || !item.str) return "";
                        return item.str.replace(/[\r\n\t"']/g, '').trim();
                    }).filter(item => item !== "");

                    if (textItems.length === 0) continue;

                    // 🕵️‍♂️ 1. 설치기사 성명 추출 (따옴표 버그 방지용 전체 문자열 통합 검색 방식)
                    let technicianName = "미지정";
                    for (let k = 0; k < textItems.length; k++) {
                        if (textItems[k].includes("설치기사") && textItems[k + 1]) {
                            // 설치기사 문구 바로 다음 인덱스나 그 다음에 쉼표를 건너뛰고 위치한 기사명을 획득
                            let nameCandidate = textItems[k + 1].replace(/,/g, '').trim();
                            if (nameCandidate === "" && textItems[k + 2]) {
                                nameCandidate = textItems[k + 2].replace(/,/g, '').trim();
                            }
                            if (nameCandidate.length >= 2 && nameCandidate.length <= 4) {
                                technicianName = nameCandidate;
                                break;
                            }
                        }
                    }

                    // 🕵️‍♂️ 2. 고객명 추출 (통합 검색 필터링 방식)
                    let customerName = "미확인";
                    for (let k = 0; k < textItems.length; k++) {
                        if (textItems[k].includes("고객명") && textItems[k + 1]) {
                            let customerCandidate = textItems[k + 1].replace(/,/g, '').trim();
                            if (customerCandidate === "" && textItems[k + 2]) {
                                customerCandidate = textItems[k + 2].replace(/,/g, '').trim();
                            }
                            if (customerCandidate.length >= 2) {
                                customerName = customerCandidate;
                                break;
                            }
                        }
                    }

                    let products = [];

                    // 📋 3. 품목 및 수량 추출 테이블 파싱
                    for (let i = 0; i < textItems.length; i++) {
                        const item = textItems[i].replace(/,/g, '').trim();
                        const upperItem = item.toUpperCase();

                        // 알파벳+숫자가 혼합된 에어컨 완제품 모델명 형태 타겟팅
                        if (/^
