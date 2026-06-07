// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// [전역 마스터 변수] - 페이지 단위 제어를 위한 핵심 저장소
let pdfDoc = null;          // 업로드된 PDF 문서 객체
let currentPdfPage = 1;     // 기사님이 현재 보고 있는 PDF 페이지 번호 (1부터 시작)
let totalPdfPages = 0;      // PDF의 총 페이지 수

// 현재 페이지(1장)에서 실시간으로 추출된 검수 대상 모델명들을 저장하는 배열
let currentPageTargetModels = []; 

// ==========================================
// 1. PDF 파일 선택 시 초기 구동 로직
// ==========================================
document.getElementById("pdfFile").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const pageIndicator = document.getElementById("pageIndicator");
    pageIndicator.innerText = "📄 대량 의뢰서 로딩 및 페이지 분할 중...";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            // 한글 깨짐 방지 처리와 함께 PDF 로드
            const loadingTask = pdfjsLib.getDocument({
                data: typedarray,
                cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/cmaps/',
                cMapPacked: true
            });
            
            pdfDoc = await loadingTask.promise;
            totalPdfPages = pdfDoc.numPages; 
            currentPdfPage = 1; // 새 파일은 무조건 1페이지부터 시작
            
            // 💡 [핵심] 1페이징 전용 연동 구동
            await loadAndRenderPage(currentPdfPage);

        } catch (error) {
            console.error("PDF 초기 로드 에러:", error);
            alert("⚠️ 의뢰서 파일 구조를 읽지 못했습니다. 파일 다운로드가 정상적으로 끝났는지 확인해 주세요.");
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 🔄 [핵심 함수] 지정된 '딱 1페이지'의 모든 데이터(이미지+텍스트+검수) 동기화
// ==========================================
async function loadAndRenderPage(pageNumber) {
    if (!pdfDoc) return;

    // 1. 페이지 변경 시 이전 페이지의 인식 결과 및 입력창 싹 다 초기화
    document.getElementById("manualInput").value = "";
    document.getElementById("ocrResult").innerHTML = "<span style='color: #64748b;'>📸 스티커 바코드 사진을 촬영해 주세요.</span>";
    document.getElementById("status").innerHTML = `<span style="color: #475569; font-weight: bold;">검수 대기</span>`;
    currentPageTargetModels = []; // 현재 페이지 대상 모델 리스트 리셋

    const canvas = document.getElementById("pdfCanvas");
    const ctx = canvas.getContext("2d");
    const pageIndicator = document.getElementById("pageIndicator");
    const orderList = document.getElementById("orderList");

    try {
        // [A] PDF 해당 페이지 객체 가져오기
        const page = await pdfDoc.getPage(pageNumber);
        
        // [B] 화면에 PDF 이미지 그리기 (1.5배 선명하게 변환)
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        await page.render(renderContext).promise;

        // [C] 💡 해당 1페이지 내부의 텍스트만 실시간 정밀 파싱 (기사, 고객, 품목 추출)
        const textContent = await page.getTextContent();
        
        // 줄바꿈, 큰따옴표 등 찌꺼기 노이즈 청소
        const textItems = textContent.items.map(item => {
            if (!item || !item.str) return "";
            return item.str.replace(/[\r\n\t"']/g, '').trim();
        }).filter(item => item !== "");

        // 🕵️‍♂️ 현재 페이지 기사명 찾기
        let technicianName = "미지정";
        const techIndex = textItems.findIndex(text => text.includes("설치기사"));
        if (techIndex !== -1 && textItems[techIndex + 1]) {
            technicianName = textItems[techIndex + 1].replace(/,/g, '').trim();
        }

        // 🕵️‍♂️ 현재 페이지 고객명 찾기
        let customerName = "미확인";
        const customerIndex = textItems.findIndex(text => text.includes("고객명"));
        if (customerIndex !== -1 && textItems[customerIndex + 1]) {
            customerName = textItems[customerIndex + 1].replace(/,/g, '').trim();
        }

        // 📋 현재 페이지 주문 품목(에어컨 완제품 모델명)만 추출
        let products = [];
        for (let i = 0; i < textItems.length; i++) {
            let upperText = textItems[i].replace(/,/g, '').trim().toUpperCase();

            if (/^[A-Z0-9._-]+$/i.test(upperText)) {
                if (upperText.startsWith('PQ')) continue; // 자재 코드 패스
                if (upperText.length < 5 || /^\d+$/.test(upperText)) continue;
                if (/^\d+-\d+/.test(upperText)) continue; // 주문서번호 패스

                let quantity = "1";
                let isNormalOrder = false;

                // 주변 범위를 탐색하여 "일반"배차 수량 확인
                for (let j = Math.max(0, i - 2); j < Math.min(textItems.length, i + 15); j++) {
                    if (textItems[j].includes("일반") || textItems[j].includes("특수")) {
                        isNormalOrder = true;
                        if (textItems[j-1] && /^[1-9]$/.test(textItems[j-1].trim())) quantity = textItems[j-1].trim();
                        else if (textItems[j+1] && /^[1-9]$/.test(textItems[j+1].trim())) quantity = textItems[j+1].trim();
                        break;
                    }
                }

                if (isNormalOrder) {
                    let cleanModel = upperText.split('.')[0].trim();
                    products.push({ model: cleanModel, qty: quantity });
                }
            }
        }

        // 중복 제거 후 최종 모델 대조군 전역 변수에 바인딩
        const uniqueProducts = [];
        const seenModels = new Set();
        products.forEach(p => {
            if (!seenModels.has(p.model)) {
                seenModels.add(p.model);
                uniqueProducts.push(p);
            }
        });

        // 타겟 모델명 전역 변수에 저장 (바코드 스캔 대조용)
        currentPageTargetModels = uniqueProducts.map(p => p.model);

        // [D] 화면 우측(또는 하단) 주문 품목 UI 영역 갱신
        let htmlContent = `
            <div style="background:#e0f2fe; color:#0369a1; padding:10px; border-radius:6px; margin-bottom:12px; font-weight:bold;">
                👷 담당기사: <span style="font-size:16px; color:#0284c7;">${technicianName}</span> 기사님
            </div>
            <div style="margin-bottom: 10px; font-size:14px; color:#334155;">
                👤 <b>고객명:</b> ${customerName} 고객님
            </div>
            <div style="font-weight:bold; margin-top:15px; margin-bottom:5px; font-size:13px; color:#4f46e5;">[주문 품목 리스트]</div>
        `;

        if (uniqueProducts.length === 0) {
            htmlContent += `<div style="color:#64748b; font-size:13px; padding:10px; background:#f1f5f9; border-radius:6px;">배정된 일반 완제품 품목이 없습니다.</div>`;
        } else {
            uniqueProducts.forEach((prod, idx) => {
                htmlContent += `
                    <div style="margin-bottom: 8px; border:1px solid #e2e8f0; padding:10px; border-radius:6px; background:white;">
                        • <b>모델 ${idx + 1}:</b> <span style="color:#b91c1c; font-weight:bold;">${prod.model}</span> 
                        <span style="float:right; color:#1e293b; font-weight:bold;">${prod.qty} 개</span>
                    </div>
                `;
            });
        }
        orderList.innerHTML = htmlContent;

        // [E] 하단 글씨 업데이트
        pageIndicator.innerText = `의뢰서 건수: ${pageNumber} / ${totalPdfPages} 장`;
        document.getElementById("status").innerHTML = `<span style="color: #2563eb; font-weight: bold;">현재 페이지 검수 대기 (품목: ${currentPageTargetModels.length}개)</span>`;

    } catch (err) {
        console.error("페이지 로딩 총체적 실패:", err);
        pageIndicator.innerText = `⚠️ ${pageNumber}페이지 데이터를 불러오는 중 에러 발생`;
    }
}

// ==========================================
// ◀ 이전 의뢰서 (앞장) 버튼 이벤트
// ==========================================
document.getElementById("prevPageBtn").addEventListener("click", async function () {
    if (!pdfDoc) {
        alert("먼저 PDF 의뢰서 파일을 선택해 주세요.");
        return;
    }
    if (currentPdfPage > 1) {
        currentPdfPage--;
        await loadAndRenderPage(currentPdfPage); // 앞장으로 이동하면서 품목, 인식결과, 검수상태 싹 다 자동 갱신
    } else {
        alert("첫 번째 의뢰서 페이지입니다.");
    }
});

// ==========================================
// ▶ 다음 의뢰서 (뒷장) 버튼 이벤트
// ==========================================
document.getElementById("nextPageBtn").addEventListener("click", async function () {
    if (!pdfDoc) {
        alert("먼저 PDF 의뢰서 파일을 선택해 주세요.");
        return;
    }
    if (currentPdfPage < totalPdfPages) {
        currentPdfPage++;
        await loadAndRenderPage(currentPdfPage); // 뒷장으로 이동하면서 품목, 인식결과, 검수상태 싹 다 자동 갱신
    } else {
        alert("마지막 의뢰서 페이지입니다.");
    }
});

// ==========================================
// 2. 바코드 사진 촬영 판독 (오직 현재 화면에 켜둔 1장하고만 비교)
// ==========================================
document.getElementById("cameraInput").addEventListener("change", async function (e) {
    const photoFile = e.target.files[0];
    if (!photoFile) return;

    const manualInput =
