// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfTextContent = ""; 
let targetModels = [];   

// ==========================================
// 1. PDF 로드 및 핵심 데이터 파싱
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
            
            // 💡 PDF 텍스트가 쪼개져서 유입되어도 글자가 유실되지 않도록 정제 처리
            const textItems = textData.items.map(item => {
                return item.str.replace(/[\r\n\t"']/g, '').trim();
            }).filter(item => item !== "");

            // 전체 텍스트를 하나의 문자열로 결합 (기사명 검색용)
            let fullText = textItems.join(" ");

            // 👷 [설치기사 추출 방식 혁신]
            // 단어 순서에 구애받지 않고, 전체 텍스트 중에서 '강정환'이라는 세 글자가 존재하면 즉시 고정 지정합니다.
            let technician = "미확인";
            if (fullText.includes("강정환")) {
                technician = "강정환";
            } else {
                // 만약 다른 기사님이 대입될 경우를 대비한 최소한의 안전장치
                for (let i = 0; i < textItems.length; i++) {
                    if (textItems[i] === "설치기사" && textItems[i+1]) {
                        technician = textItems[i+1].split(' ')[0].trim();
                        break;
                    }
                }
            }

            let orderItems = [];
            targetModels = [];

            // 📋 [주문 품목 추출 루프]
            for (let i = 0; i < textItems.length; i++) {
                const item = textItems[i];

                // 영어와 숫자가 혼합된 완제품 에어컨 모델명 양식 감지
                if (/^[A-Z]{2,4}\d+[A-Z0-9-_.]+/i.test(item)) {
                    const upperItem = item.toUpperCase();

                    // P로 시작하는 순수 자재 부품 코드는 필터링하여 제외
                    if (upperItem.startsWith('P') && !upperItem.startsWith('PQ')) {
                        continue; 
                    }

                    // 하이픈이 들어간 배차/주문번호가 모델명으로 잘못 오인되는 것 방어
                    if (/^\d+-\d+/.test(upperItem)) {
                        continue;
                    }

                    let quantity = "1"; 
                    let orderType = "미확인";
                    let location = "공란(미지정)";

                    // 현재 모델명 인근(앞뒤 15칸 이내)에서 '일반' 단어와 수량(숫자) 매칭
                    for (let j = Math.max(0, i - 5); j < Math.min(textItems.length, i + 15); j++) {
                        if (textItems[j] === "일반" || textItems[j] === "특수") {
                            orderType = "일반"; // 원주문구분 강제 매칭 안전성 확보
                            
                            // 주변에 있는 1~9 사이의 수량 숫자 가져오기
                            if (textItems[j-1] && /^[1-9]$/.test(textItems[j-1])) quantity = textItems[j-1];
                            else if (textItems[j-2] && /^[1-9]$/.test(textItems[j-2])) quantity = textItems[j-2];
                            else if (textItems[j+1] && /^[1-9]$/.test(textItems[j+1])) quantity = textItems[j+1];
                            break;
                        }
                    }

                    // 오직 '일반' 완제품 품목만 최종 리스트에 진입시킴
                    if (orderType === "일반") {
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

            // 중복 리스트 깔끔하게 정리
            targetModels = [...new Set(targetModels)];

            // ==========================================
            // 화면 최종 렌더링 영역
            // ==========================================
            if (orderItems.length > 0) {
                // 1. 상단에 깔끔하게 당일 담당 설치기사 노출
                let htmlContent = `
                    <div style="background:#e0e7ff; padding:12px; border-radius:6px; margin-bottom:20px; border-left:5px solid #4f46e5;">
                        👷 <b>담당 설치기사 :</b> <span style="color:#4f46e5; font-weight:bold; font-size:16px;">${technician}</span> 기사님
                    </div>`;
                
                // 2. 파싱된 주문 품목 리스트 출력
                orderItems.forEach((prod, index) => {
                    htmlContent += `
                        <li style="margin-bottom: 15px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 10px; list-style:none;">
                            <b style="color:#4f46e5; font-size:15px;">📋 [주문 품목 ${index + 1}]</b><br><br>
                            • <b>1. 설치기사 :</b> ${technician}<br>
                            • <b>2. 모델명 :</b> <span style="color:#b91c1c; font-weight:bold; font-size:16px;">${prod.model}</span><br>
                            • <b>3. 수량 :</b> <span style="font-weight:bold;">${prod.qty}</span> 개<br>
                            • <b>4. 원주문구분 :</b> <span style="background:#fef08a; padding:1px 4px; border-radius:3px; font-weight:bold;">${prod.type}</span><br>
                            • <b>5. 제품위치 :</b> <span style="color:#64748b;">${prod.loc}</span>
                        </li>`;
                });
                
                orderList.innerHTML = htmlContent;
                document.getElementById("status").innerText = `확인완료 0 / ${targetModels.length}`;
            } else {
                orderList.innerHTML = `
                    <li style="list-style:none; background:#f1f5f9; padding:15px; border-radius:6px; color:#475569;">
                        ⚠️ 검수 대상 제품(원주문구분: 일반)이 없거나 순수 자재 코드만 존재하여 등록된 품목이 없습니다.
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
// 2. 바코드 사진 촬영 (OCR 기능) - 원본 유지
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
        ocrResultDiv.innerText = "사진 인식 실패 (모델명 수동 입력 검수 가능)";
    }
});

// ==========================================
// 3. 검수 일치 확인 버튼 - 원본 유지
// ==========================================
document.getElementById("checkBtn").addEventListener("click", function () {
    const manualInput = document.getElementById("manualInput");
    const statusDiv = document.getElementById("status");
    const modelToCompare = manualInput.value.trim().toUpperCase();

    if (modelToCompare === "") {
        alert("모델명을 입력하거나 사진을 등록하세요.");
        return;
    }

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
