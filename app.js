// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; 
let targetModels = [];   

// ==========================================
// 1. PDF 로드 및 5대 중요 데이터 핀포인트 파싱
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
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            const page = await pdf.getPage(1);
            const canvas = document.getElementById("pdfViewer");
            const context = canvas.getContext("2d");
            const viewport = page.getViewport({ scale: 1.2 }); 

            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvas.style.display = "block";
            await page.render({ canvasContext: context, viewport: viewport }).promise;

            const textData = await page.getTextContent();
            // 텍스트 조각들을 순서대로 배열화하고 공백 제거 처리
            const textItems = textData.items.map(item => item.str.trim()).filter(item => item !== "");
            pdfTextContent = textItems.join(" ");

            // [5대 중요 항목 초기 변수 정의]
            let technician = "미확인";
            let orderItems = [];
            targetModels = [];

            // 💡 [중요도 1순위] 설치기사 이름 정밀 추출 
            // 의뢰서에서 "설치기사" 단어 뒤에 바로 이름이 오지 않는 경우를 대비해 주변 배열을 정밀 탐색합니다.
            for (let i = 0; i < textItems.length; i++) {
                if (textItems[i] === "설치기사") {
                    // "설치기사" 키워드 이후 3칸 이내에서 고객명("강시영")이나 타이틀이 아닌 진짜 기사 이름("강정환")을 매칭
                    for (let j = i + 1; j <= i + 3; j++) {
                        if (textItems[j] && textItems[j] !== "확인" && !textItems[j].includes("고객명")) {
                            technician = textItems[j].replace(/\n/g, ''); // 줄바꿈 제거
                            break;
                        }
                    }
                    break;
                }
            }

            // 💡 [중요도 2~5순위] 표 내부 데이터 매칭 추출 (모델명, 수량, 원주문구분, 제품위치)
            for (let i = 0; i < textItems.length; i++) {
                const item = textItems[i];

                // 에어컨 및 가전 제품명 정규식 (알파벳+숫자 조합 패턴)
                if (/^[A-Z]{2,4}\d+[A-Z0-9-_.]+/i.test(item)) {
                    
                    const upperItem = item.toUpperCase();

                    // ❌ [요청 반영] P로 시작하는 순수 '자재 부품'은 품목에 올리지 않고 완벽 배제합니다.
                    // 단, 기사님이 보여주신 의뢰서의 'PQ060907A01'처럼 PQ로 시작하는 가전 제품군은 통과시킵니다.
                    if (upperItem.startsWith('P') && !upperItem.startsWith('PQ')) {
                        continue; 
                    }

                    let quantity = "1"; // 기본값
                    let orderType = "미확인";
                    let location = "공란(미지정)";

                    // 테이블 구조상 모델명 기준 뒤쪽 데이터 영역(최대 10개 칸)에서 정보 수집
                    for (let j = i + 1; j < Math.min(i + 12, textItems.length); j++) {
                        const nextItem = textItems[j];

                        // 원주문구분 찾기
                        if (nextItem === "일반" || nextItem === "특수") {
                            orderType = nextItem;
                            
                            // 원주문구분("일반") 바로 직전 칸이나 주변에 위치한 수량(숫자) 수집
                            if (textItems[j-1] && /^\d+$/.test(textItems[j-1])) {
                                quantity = textItems[j-1];
                            } else if (textItems[j-2] && /^\d+$/.test(textItems[j-2])) {
                                quantity = textItems[j-2];
                            }
                            break;
                        }
                    }

                    // 💡 오직 원주문구분이 '일반'인 제품만 리스트에 등록합니다.
                    if (orderType === "일반") {
                        // 제품명 뒤에 붙은 유통코드(.AKOR 등)를 잘라내어 순수 모델명만 추출
                        let cleanModel = item.split('.')[0].trim().toUpperCase();
                        
                        targetModels.push(cleanModel);

                        orderItems.push({
                            model: cleanModel,
                            qty: quantity,
                            type: orderType,
                            loc: location
                        });
                    }
                }
            }

            // 모델명 중복 제거
            targetModels = [...new Set(targetModels)];

            // ==========================================
            // 화면 업데이트 (중요도 순서대로 정렬 표시)
            // ==========================================
            if (orderItems.length > 0) {
                // 1순위 설치기사 상단 고정
                let htmlContent = `
                    <li style="list-style:none; margin-bottom:15px; background:#e0e7ff; padding:10px; border-radius:6px; border-left:5px solid #4f46e5;">
                        👷 <b>1. 설치기사 :</b> <span style="font-size:16px; color:#1e1b4b;">${technician}</span>
                    </li>`;
                
                // 2~5순위 제품 상세 내역 렌더링
                orderItems.forEach((prod, index) => {
                    htmlContent += `
                        <li style="margin-bottom: 12px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px; list-style:none;">
                            <b style="color:#4f46e5;">📋 [주문 품목 ${index + 1}]</b><br>
                            • <b>2. 모델명 :</b> <span style="color:#b91c1c; font-weight:bold;">${prod.model}</span><br>
                            • <b>3. 수량 :</b> ${prod.qty} 개<br>
                            • <b>4. 원주문구분 :</b> <span style="background:#fef08a; padding:1px 4px; border-radius:3px;">${prod.type}</span><br>
                            • <b>5. 제품위치 :</b> <span style="color:#64748b;">${prod.loc}</span>
                        </li>`;
                });
                
                orderList.innerHTML = htmlContent;
                document.getElementById("status").innerText = `확인완료 0 / ${targetModels.length}`;
            } else {
                orderList.innerHTML = `
                    <li style="list-style:none; background:#f1f5f9; padding:10px; border-radius:6px;">
                        👷 <b>1. 설치기사 :</b> ${technician}<br><br>
                        ⚠️ 검수 대상 제품(원주문구분: 일반)이 없거나 자재 코드만 발견되어 품목 등록이 제외되었습니다.
                    </li>`;
                document.getElementById("status").innerText = `확인완료 0 / 0`;
            }

        } catch (error) {
            console.error(error);
            orderList.innerHTML = "<li>설치의뢰서 양식 파싱 오류가 발생했습니다.</li>";
        }
    };
    fileReader.readAsArrayBuffer(file);
});

// ==========================================
// 2. 사진 촬영 시 자동 글자 읽기 기능
// ==========================================
document.getElementById("cameraInput").addEventListener("change", async function (e) {
    const photoFile = e.target.files[0];
    if (!photoFile) return;

    const manualInput = document.getElementById("manualInput");
    const ocrResultDiv = document.getElementById("ocrResult");
    
    manualInput.value = "";
    ocrResultDiv.innerText = "⏳ 스티커 일련번호 판독 중...";

    try {
        const result = await Tesseract.recognize(photoFile, 'eng', {
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        });
        
        const detectedText = result.data.text.replace(/\s+/g, '').toUpperCase();
        ocrResultDiv.innerText = "인식 완료! [검수] 버튼을 눌러주세요.";

        for (let model of targetModels) {
            if (detectedText.includes(model)) {
                manualInput.value = model;
                break;
            }
        }
    } catch (err) {
        ocrResultDiv.innerText = "사진 인식 실패 (수동 입력 검수 가능)";
    }
});

// ==========================================
// 3. 검수 버튼 클릭 (최종 매칭)
// ==========================================
document.getElementById("checkBtn").addEventListener("click", function () {
    const manualInput = document.getElementById("manualInput");
    const statusDiv = document.getElementById("status");
    const modelToCompare = manualInput.value.trim().toUpperCase();

    if (modelToCompare === "") {
        alert("모델명을 입력하거나 사진을 등록하세요.");
        return;
    }

    // 수동 입력 시 한 번 더 자재 코드 차단 안전장치
    if (modelToCompare.startsWith('P') && !modelToCompare.startsWith('PQ')) {
        alert("❌ 해당 코드는 자재 부품이므로 검수 대상이 아닙니다.");
        return;
    }

    const isMatched = targetModels.includes(modelToCompare);

    if (isMatched) {
        alert(`✅ 검수 성공!\n의뢰서 정보와 일치합니다: ${modelToCompare}`);
        statusDiv.innerHTML = `<span style="color: green; font-weight: bold;">확인완료 1 / ${targetModels.length} (일치: ${modelToCompare})</span>`;
    } else {
        alert(`❌ 검수 실패!\n검수 대상 품목 목록에 [${modelToCompare}] 제품이 존재하지 않습니다.`);
        statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">미일치 제품 발견</span>`;
    }
});
