// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; 
let targetModels = [];   

// 1. PDF 로드 및 텍스트 추출 (기존 로직 유지)
document.getElementById("pdfFile").addEventListener("change", async function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const orderList = document.getElementById("orderList");
    orderList.innerHTML = "<li>설치의뢰서 분석 중...</li>";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            const page = await pdf.getPage(1);
            const canvas = document.getElementById("pdfViewer");
            const context = canvas.getContext("2d");
            const viewport = page.getViewport({ scale: 1.2 }); // 속도를 위해 스케일 살짝 조정

            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvas.style.display = "block";
            await page.render({ canvasContext: context, viewport: viewport }).promise;

            const textData = await page.getTextContent();
            pdfTextContent = textData.items.map(item => item.str).join(" ").replace(/\s+/g, ''); // 공백 제거 후 저장

            // 모델명 패턴 추출 (현장 제품 코드 위주)
            const modelPattern = /[A-Z0-9]{5,}/g; 
            const foundModels = pdfTextContent.match(modelPattern) || [];
            targetModels = [...new Set(foundModels)].filter(m => m.length > 5);

            orderList.innerHTML = targetModels.length > 0 
                ? targetModels.map(m => `<li>📦 모델명: <b>${m}</b></li>`).join("")
                : "<li>모델명을 추출할 수 없습니다. 수동 검수를 이용하세요.</li>";
            
            document.getElementById("status").innerText = `확인완료 0 / ${targetModels.length}`;
        } catch (error) {
            orderList.innerHTML = "<li>PDF 로드 오류</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// 2. 검수 로직 (속도 최적화 핵심)
document.getElementById("checkBtn").addEventListener("click", async function () {
    const cameraInput = document.getElementById("cameraInput");
    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    const photoFile = cameraInput.files[0];

    let modelToCompare = manualInput.value.trim();

    if (!photoFile && modelToCompare === "") {
        alert("사진을 찍거나 모델명을 입력하세요.");
        return;
    }

    // 사진이 있을 경우에만 OCR 실행
    if (photoFile) {
        ocrResultDiv.innerText = "⏳ 빠르게 판독 중... (잠시만 기다려주세요)";
        
        try {
            // Tesseract.js 실행 (worker 생성 방식을 사용하여 한 번만 실행 후 종료)
            const worker = await Tesseract.createWorker({
                logger: m => console.log(m.progress) // 진행 상황 확인용
            });
            await worker.loadLanguage('eng+kor');
            await worker.initialize('eng+kor');
            
            // 인식률을 높이기 위해 'whitelist' 설정 (모델명에 주로 쓰이는 문자만 집중 분석)
            await worker.setParameters({
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
            });

            const { data: { text } } = await worker.recognize(photoFile);
            const cleanPhotoText = text.replace(/\s+/g, ''); // 인식된 글자 공백 제거
            
            ocrResultDiv.innerText = "인식된 글자: " + text.substring(0, 50) + "...";

            // 추출된 모델명들과 대조
            if (modelToCompare === "") {
                for (let model of targetModels) {
                    if (cleanPhotoText.includes(model)) {
                        modelToCompare = model;
                        manualInput.value = model;
                        break;
                    }
                }
            }

            await worker.terminate(); // 분석 종료 후 즉시 워커 해제 (메모리 확보)

        } catch (err) {
            ocrResultDiv.innerText = "판독 실패 (수동 입력 필요)";
        }
    }

    // 최종 검증 결과 표시
    const statusDiv = document.getElementById("status");
    if (modelToCompare !== "" && (pdfTextContent.includes(modelToCompare) || targetModels.includes(modelToCompare))) {
        statusDiv.innerHTML = `<span style="color: green;">✅ 일치: ${modelToCompare}</span>`;
        alert("검수 완료!");
    } else {
        statusDiv.innerHTML = `<span style="color: red;">❌ 불일치 또는 미인식</span>`;
        alert("의뢰서와 제품 정보가 맞지 않습니다.");
    }
});
