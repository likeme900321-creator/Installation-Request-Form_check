// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// 전역 변수 설정
let pdfDoc = null;          // 불러온 PDF 문서 객체를 저장
let currentPdfPage = 1;     // 현재 기사님이 보고 있는 페이지 번호 (1페이지부터 시작)
let totalPdfPages = 0;      // 업로드된 PDF의 총 페이지 수

// ==========================================
// 1. PDF 파일 선택 시 문서 로드 처리
// ==========================================
document.getElementById("pdfFile").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const pageIndicator = document.getElementById("pageIndicator");
    pageIndicator.innerText = "📄 대량 PDF 문서 로딩 및 이미지 변환 중...";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            // PDF 문서 열기 (한글 맵 포함 안전 로드)
            const loadingTask = pdfjsLib.getDocument({
                data: typedarray,
                cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/cmaps/',
                cMapPacked: true
            });
            
            pdfDoc = await loadingTask.promise;
            totalPdfPages = pdfDoc.numPages; // 총 페이지 수 저장
            
            currentPdfPage = 1; // 파일 새로 올리면 무조건 1페이지부터 보여줌
            
            // 💡 딱 1장만 화면에 이미지로 그리는 함수 호출
            renderPageToImage(currentPdfPage);

        } catch (error) {
            console.error("PDF 로딩 실패:", error);
            alert("⚠️ PDF 파일을 불러오지 못했습니다. 파일이 손상되었거나 브라우저 용량 초과일 수 있습니다.");
            pageIndicator.innerText = "의뢰서 건수: 0 / 0 (오류 발생)";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 🔄 핵심: 지정된 '딱 1페이지'만 이미지(Canvas)로 그리는 함수
// ==========================================
async function renderPageToImage(pageNumber) {
    if (!pdfDoc) return;

    const canvas = document.getElementById("pdfCanvas");
    const ctx = canvas.getContext("2d");
    const pageIndicator = document.getElementById("pageIndicator");

    try {
        // 1. 해당 페이지 객체 가져오기
        const page = await pdfDoc.getPage(pageNumber);
        
        // 2. 스마트폰 화면 비율에 맞게 선명도(Scale) 조절 (기본 1.5배 선명하게)
        const viewport = page.getViewport({ scale: 1.5 });
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // 3. 캔버스에 PDF 내용을 이미지로 렌더링(그리기)
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        
        await page.render(renderContext).promise;

        // 4. 하단 페이지 표시 글자 업데이트
        pageIndicator.innerText = `의뢰서 건수: ${pageNumber} / ${totalPdfPages} 장`;

    } catch (renderError) {
        console.error("페이지 이미지 변환 오류:", renderError);
        pageIndicator.innerText = `⚠️ ${pageNumber}페이지 이미지를 그리지 못했습니다.`;
    }
}

// ==========================================
// ◀ [이전장] 버튼 이벤트
// ==========================================
document.getElementById("prevPageBtn").addEventListener("click", function () {
    if (!pdfDoc) {
        alert("먼저 PDF 의뢰서 파일을 선택해 주세요.");
        return;
    }
    
    if (currentPdfPage > 1) {
        currentPdfPage--; // 페이지 번호 1 감소
        renderPageToImage(currentPdfPage); // 해당 장 1장만 새로 그리기
    } else {
        alert("첫 번째 의뢰서 페이지입니다.");
    }
});

// ==========================================
// ▶ [다음장] 버튼 이벤트
// ==========================================
document.getElementById("nextPageBtn").addEventListener("click", function () {
    if (!pdfDoc) {
        alert("먼저 PDF 의뢰서 파일을 선택해 주세요.");
        return;
    }
    
    if (currentPdfPage < totalPdfPages) {
        currentPdfPage++; // 페이지 번호 1 증가
        renderPageToImage(currentPdfPage); // 해당 장 1장만 새로 그리기
    } else {
        alert("마지막 의뢰서 페이지입니다.");
    }
});
