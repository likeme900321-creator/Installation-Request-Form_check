// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; // PDF에서 추출한 텍스트를 저장할 변수
let targetModels = [];   // 주문 품목에서 찾아낸 모델명 목록 변수

// ==========================================
// 1. PDF 파일 로드 및 화면 표시 + 텍스트 추출
// ==========================================
document.getElementById("pdfFile").addEventListener("change", async function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const orderList = document.getElementById("orderList");
    orderList.innerHTML = "<li>설치의뢰서 분석 중...</li>";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);

        try {
            // PDF 문서 불러오기
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            const page = await pdf.getPage(1); // 1페이지 전용

            // 렌더링할 캔버스 가져오기 및 설정
            const canvas = document.getElementById("pdfViewer");
            const context = canvas.getContext("2d");
            const viewport = page.getViewport({ scale: 1.5 }); // 해상도 배율

            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvas.style.display = "block"; // 숨겨져 있던 캔버스 표시

            // 💡 PDF 화면에 그리기
            await page.render({ canvasContext: context, viewport: viewport }).promise;

            // PDF 텍스트 데이터 추출
            const textData = await page.getTextContent();
            pdfTextContent = textData.items.map(item => item.str).join(" ");

            // [주문 품목 파싱 예시] 
            // 실제 에어컨 모델명 규칙(정규식)을 이용해 텍스트에서 모델명만 뽑아냅니다.
            // 삼성/LG 에어컨 모델명 패턴 예시 (알파벳+숫자 조합 5글자 이상)
            const modelPattern = /[A-Z]{2,4}\d{2,4}[A-Z0-9]+/g; 
            const foundModels = pdfTextContent.match(modelPattern) || [];
            
            // 중복 제거 후 저장
            targetModels = [...new Set(foundModels)];

            if (targetModels.length > 0) {
                orderList.innerHTML = targetModels.map(m => `<li>📦 모델명: <b>${m}</b></li>`).join("");
                document.getElementById("status").innerText = `확인완료 0 / ${targetModels.length}`;
            } else {
                // 모델명 패턴 감지가 안 될 경우 전체 텍스트 요약 표시
                orderList.innerHTML = `<li>의뢰서 로드 완료 (모델명 자동 추출 실패 시 직접 입력란을 이용해 주세요)</li>`;
                document.getElementById("status").innerText = `확인완료 0 / 1`;
            }

        } catch (error) {
            console.error(error);
            orderList.innerHTML = "<li>PDF를 불러오는 중 오류가 발생했습니다.</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});


// ==========================================
// 2. 검수 버튼 클릭 시: 사진 OCR 분석 및 비교 검수
// ==========================================
document.getElementById("checkBtn").addEventListener("click", async function () {
    const cameraInput = document.getElementById("cameraInput");
    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    const statusDiv = document.getElementById("status");

    let modelToCompare = manualInput.value.trim();
    const photoFile = cameraInput.files[0];

    // 수동 입력도 없고 사진도 없다면 리턴
    if (modelToCompare === "" && !photoFile) {
        alert("모델명을 직접 입력하거나 스티커 사진을 등록하세요.");
        return;
    }

    // 사진이 등록되어 있다면 OCR 진행
    if (photoFile) {
        ocrResultDiv.innerText = "⏳ 스티커 사진에서 제품명 판독 중...";
        try {
            const result = await Tesseract.recognize(photoFile, 'kor+eng');
            const detectedText = result.data.text;
            
            ocrResultDiv.innerText = detectedText; // 판독 결과 출력

            // 사진에서 읽어온 글자 중 등록된 주문 모델명이 포함되어 있는지 찾기
            if (modelToCompare === "") {
                for (let model of targetModels) {
                    if (detectedText.replaceAll(" ", "").includes(model)) {
                        modelToCompare = model;
                        manualInput.value = model; // 텍스트창에 자동 입력
                        break;
                    }
                }
            }
        } catch (err) {
            console.error(err);
            ocrResultDiv.innerText = "사진 인식 실패 (수동으로 입력하여 검수 가능)";
        }
    }

    // 최종 매칭 검증
    if (modelToCompare === "") {
        alert("사진에서 일치하는 제품명을 찾지 못했습니다. 직접 입력해 주세요.");
        return;
    }

    // PDF 텍스트 혹은 분석된 모델 목록에 존재하는지 체크
    const isMatched = pdfTextContent.includes(modelToCompare) || targetModels.includes(modelToCompare);

    if (isMatched) {
        alert(`✅ 검수 성공! [${modelToCompare}] 제품이 설치의뢰서 정보와 일치합니다.`);
        statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">확인완료 1 / ${targetModels.length || 1} (일치: ${modelToCompare})</span>`;
    } else {
        alert(`❌ 검수 실패! [${modelToCompare}]은(는) 의뢰서에 없는 모델입니다.`);
        statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">미일치 제품 발견 (확인 필요)</span>`;
    }
});
