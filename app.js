<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>설치의뢰서 검수 시스템</title>
    <style>
        body { font-family: 'Malgun Gothic', sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #334155; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
        h1 { font-size: 22px; text-align: center; margin-bottom: 25px; color: #1e293b; }
        .card { background: #fdfdfd; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
        h3 { margin-top: 0; font-size: 16px; color: #4f46e5; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
        input[type="file"] { width: 100%; padding: 8px; border: 1px dashed #cbd5e1; border-radius: 6px; background: #f8fafc; cursor: pointer; }
        input[type="text"] { width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; font-size: 14px; }
        button { width: 100%; background: #4f46e5; color: white; border: none; padding: 12px; border-radius: 6px; font-size: 15px; font-weight: bold; cursor: pointer; margin-top: 10px; transition: background 0.2s; }
        button:hover { background: #4338ca; }
        ul { padding-left: 0; margin: 0; }
        #pdfViewer { display: none; width: 100%; max-height: 300px; border: 1px solid #cbd5e1; margin-top: 10px; border-radius: 6px; }
        #ocrResult { font-weight: bold; color: #475569; margin-top: 5px; font-size: 13px; }
        #status { font-size: 16px; text-align: center; margin-top: 15px; }
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js"></script>
    <script src="https://unpkg.com/tesseract.js@v4.0.1/dist/tesseract.min.js"></script>
</head>
<body>

<div class="container">
    <h1>물류 모바일 검수 시스템</h1>

    <div class="card">
        <h3>📄 설치의뢰서 (PDF) 등록</h3>
        <input type="file" id="pdfFile" accept=".pdf">
        <canvas id="pdfViewer"></canvas>
    </div>

    <div class="card">
        <h3>📋 추출된 주문 품목 리스트</h3>
        <ul id="orderList">
            <li style="list-style:none; color:#64748b;">아직 분석된 품목이 없습니다.</li>
        </ul>
    </div>

    <div class="card">
        <h3>📸 스티커 일련번호 검수</h3>
        <input type="file" id="cameraInput" accept="image/*" capture="environment">
        <br><br>
        <input type="text" id="manualInput" placeholder="모델명 직접 입력 또는 사진 인식 자동 입력">
        <button id="checkBtn">현장 제품 검수하기</button>
    </div>

    <div class="card">
        <h3>🔎 검수 매칭 결과</h3>
        <div id="ocrResult">대기 중...</div>
        <hr style="border:0; border-top:1px dashed #e2e8f0; margin:12px 0;">
        <div id="status" style="font-weight:bold; color:#1e293b;">확인완료 0 / 0</div>
    </div>
</div>

<script>
// PDF.js 기본 워커 지정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let targetModels = [];   

// ==========================================
// 로직 1. PDF 분석 및 품목 리스트업
// ==========================================
document.getElementById("pdfFile").addEventListener("change", async function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const orderList = document.getElementById("orderList");
    orderList.innerHTML = "<li>의뢰서 품목 분석 중...</li>";

    const fileReader = new FileReader();
    fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            const page = await pdf.getPage(1);
            const canvas = document.getElementById("pdfViewer");
            const context = canvas.getContext("2d");
            const viewport = page.getViewport({ scale: 1.0 });

            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvas.style.display = "block";
            await page.render({ canvasContext: context, viewport: viewport }).promise;

            const textData = await page.getTextContent();
            const textItems = textData.items.map(item => item.str.replace(/[\r\n\t"']/g, '').trim()).filter(item => item !== "");

            let orderItems = [];
            targetModels = [];

            for (let i = 0; i < textItems.length; i++) {
                const item = textItems[i];
                const upperItem = item.toUpperCase();

                // 🛑 [근본적 해결] 실제 에어컨 완제품 모델명 패턴만 통과시키는 초정밀 가이드라인
                // 1. PQ로 시작하는 완제품이거나, S 또는 F 또는 위주의 실제 에어컨 완제품 모델 코드 형태 패턴 분석
                // 2. 단, P로 시작하되 PQ가 아닌 순수 자재용 부품 코드는 첫 단계에서 무조건 스킵(차단)합니다.
                if (upperItem.startsWith('P') && !upperItem.startsWith('PQ')) {
                    continue; 
                }

                // 영어 2~4자로 시작하고 숫자가 연이어 나오는 실제 '완제품 가전 모델명 형태' 패턴 검사 규칙 강화
                if (/^[A-Z]{2,4}\d+[A-Z0-9-_.]+/i.test(item)) {
                    
                    // 주문서 번호나 날짜 형태의 무관한 코드가 들어오는 것을 방지하는 안전장치
                    if (upperItem.includes('-') && /^\d+-\d+/.test(upperItem)) {
                        continue; 
                    }

                    let quantity = "1"; 
                    let orderType = "미확인";
                    let location = "공란(미지정)";

                    // 주변 데이터 영역에서 원주문구분('일반') 및 수량 추적
                    for (let j = i + 1; j < Math.min(i + 15, textItems.length); j++) {
                        const nextItem = textItems[j];
                        if (nextItem === "일반" || nextItem === "특수") {
                            orderType = nextItem;
                            if (textItems[j-1] && /^\d+$/.test(textItems[j-1])) quantity = textItems[j-1];
                            else if (textItems[j-2] && /^\d+$/.test(textItems[j-2])) quantity = textItems[j-2];
                            else if (textItems[j+1] && /^\d+$/.test(textItems[j+1])) quantity = textItems[j+1];
                            break;
                        }
                    }

                    // 오직 원주문구분이 '일반'인 진짜 에어컨 완제품 세트/단품 항목만 최종 필터링 등록
                    if (orderType === "일반") {
                        let cleanModel = item.split('.')[0].trim().toUpperCase();
                        
                        // 중복 유입 및 무관한 단어 차단 안전장치
                        if(cleanModel.length >= 5) {
                            targetModels.push(cleanModel);
                            orderItems.push({ model: cleanModel, qty: quantity, type: orderType, loc: location });
                        }
                    }
                }
            }

            // 중복 모델 제거
            targetModels = [...new Set(targetModels)];

            // 화면 최종 출력 (설치기사 및 불필요한 노이즈 완전 박멸)
            if (orderItems.length > 0) {
                let htmlContent = "";
                orderItems.forEach((prod, index) => {
                    htmlContent += `
                        <li style="margin-bottom: 15px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 10px; list-style:none;">
                            <b style="color:#4f46e5; font-size:14px;">📋 [주문 품목 ${index + 1}]</b><br><br>
                            • <b>1. 모델명 :</b> <span style="color:#b91c1c; font-weight:bold; font-size:16px;">${prod.model}</span><br>
                            • <b>2. 수량 :</b> <span style="font-weight:bold;">${prod.qty}</span> 개<br>
                            • <b>3. 원주문구분 :</b> <span style="background:#fef08a; padding:1px 4px; border-radius:3px; font-weight:bold;">${prod.type}</span><br>
                            • <b>4. 제품위치 :</b> <span style="color:#64748b;">${prod.loc}</span>
                        </li>`;
                });
                orderList.innerHTML = htmlContent;
                document.getElementById("status").innerText = `확인완료 0 / ${targetModels.length}`;
            } else {
                orderList.innerHTML = `<li style="list-style:none; padding:10px; background:#f1f5f9; border-radius:6px;">⚠️ 검수 대상 완제품 품목이 없습니다.</li>`;
                document.getElementById("status").innerText = `확인완료 0 / 0`;
            }

        } catch (error) {
            console.error(error);
            orderList.innerHTML = "<li>의뢰서 문서 파싱 실패</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 로직 2. 카메라 촬영 및 OCR 글자 인식
// ==========================================
document.getElementById("cameraInput").addEventListener("change", async function (e) {
    const photoFile = e.target.files[0];
    if (!photoFile) return;

    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    
    manualInput.value = "";
    ocrResultDiv.innerText = "⏳ 스티커 글자 분석 중...";

    try {
        const result = await Tesseract.recognize(photoFile, 'eng', {
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        });
        
        const detectedText = result.data.text.replace(/\s+/g, '').toUpperCase();
        ocrResultDiv.innerText = "인식 완료! 검수 버튼을 눌러주세요.";

        for (let model of targetModels) {
            if (detectedText.includes(model)) {
                manualInput.value = model;
                break;
            }
        }
    } catch (err) {
        ocrResultDiv.innerText = "인식 실패 (수동 입력 가능)";
    }
});

// ==========================================
// 로직 3. 현장 제품 검수 매칭 확인
// ==========================================
document.getElementById("checkBtn").addEventListener("click", function () {
    const manualInput = document.getElementById("manualInput");
    const statusDiv = document.getElementById("status");
    const modelToCompare = manualInput.value.trim().toUpperCase();

    if (modelToCompare === "") {
        alert("모델명을 입력하시거나 사진을 찍어주세요.");
        return;
    }

    if (modelToCompare.startsWith('P') && !modelToCompare.startsWith('PQ')) {
        alert("❌ 자재용 부품 코드는 검수 대상이 아닙니다.");
        return;
    }

    if (targetModels.includes(modelToCompare)) {
        alert(`✅ 일치 확인!\n의뢰서 제품이 맞습니다: ${modelToCompare}`);
        statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">확인완료 1 / ${targetModels.length} (일치: ${modelToCompare})</span>`;
    } else {
        alert(`❌ 일치하지 않음!\n리스트에 없는 제품입니다: ${modelToCompare}`);
        statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">미일치 제품 존재</span>`;
    }
});
</script>

</body>
</html>
