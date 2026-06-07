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
            
            // 💡 [중요] 줄바꿈과 따옴표, 쉼표를 제거하고 순수 데이터만 추출하여 배열화합니다.
            const textItems = textData.items.map(item => {
                return item.str.replace(/[\r\n\t"']/g, '').trim();
            }).filter(item => item !== "");

            pdfTextContent = textItems.join(" ");

            // [5대 중요 항목 초기 변수]
            let technician = "미확인";
            let orderItems = [];
            targetModels = [];

            // 💡 [원인 분석 반영] 설치기사 가로/세로 꼬임 해결 알고리즘
            // "설치기사" 키워드를 찾으면, 가로 쪼개기 오류로 인해 뒤로 밀려난 진짜 이름 조각을 
            // 시스템 노이즈를 전부 스킵하면서 정밀 추적합니다.
            for (let i = 0; i < textItems.length; i++) {
                // 문서에서 "설치기사" 단어 자체를 포함하거나 일치하는 구간을 만났을 때
                if (textItems[i] === "설치기사" || textItems[i].includes("설치기사")) {
                    
                    // 만약 텍스트 조각 자체가 "설치기사 강정환" 처럼 결합되어 들어온 경우 바로 추출
                    if (textItems[i].includes(" ") && textItems[i].length > 4) {
                        const directName = textItems[i].replace("설치기사", "").trim();
                        if (/^[가-힣]{2,4}$/.test(directName)) {
                            technician = directName;
                            break;
                        }
                    }

                    // 가로 구조로 쪼개져서 뒤로 밀린 경우, 최대 8칸까지 넓혀서 추적
                    for (let j = i + 1; j <= i + 8; j++) {
                        if (textItems[j]) {
                            const cand = textItems[j];

                            // ❌ 기사님 이름이 될 수 없는 명백한 타이틀 노이즈들을 완벽 필터링
                            if (cand === "확인" || 
                                cand.includes("고객") || 
                                cand.includes("연락") || 
                                cand.includes("최종") || 
                                cand.includes("성명") || 
                                cand.includes("주소") || 
                                cand.includes("배관") ||
                                cand.includes("YES") ||
                                cand.includes("NO")) {
                                continue; // 기사 이름이 아니므로 다음 칸 확인
                            }

                            // 🔎 진짜 기사님 성함 조건: 2~4자 사이의 순수 한글 이름만 허용
                            if (/^[가-힣]{2,4}$/.test(cand)) {
                                technician = cand;
                                break; // j 루프 탈출
                            }
                        }
                    }
                    // 기사님 이름을 성공적으로 매칭했다면 더 이상 아래쪽 테이블로 내려가지 않고 즉시 루프 종료!
                    if (technician !== "미확인") break;
                }
            }

            // 💡 [정밀 필터] 표 내부 데이터 매칭 추출 (자재 원천 차단 및 일반 주문만)
            for (let i = 0; i < textItems.length; i++) {
                const item = textItems[i];

                // 가전 완제품 모델명 패턴 분석 (영어 대문자 + 숫자 조합 형태)
                if (/^[A-Z]{2,4}\d+[A-Z0-9-_.]+/i.test(item)) {
                    
                    const upperItem = item.toUpperCase();

                    // ❌ [자재 차단] P로 시작하는 모델명은 순수 자재이므로 완벽 배제
                    // 단, PQ로 시작하는 모델명(예: PQ060907A01)은 실제 완제품 가전이므로 통과
                    if (upperItem.startsWith('P') && !upperItem.startsWith('PQ')) {
                        continue; 
                    }

                    let quantity = "1"; 
                    let orderType = "미확인";
                    let location = "공란(미지정)";

                    // 모델명 발견 지점 이후 영역에서 수량과 원주문구분('일반')을 추적
                    for (let j = i + 1; j < Math.min(i + 15, textItems.length); j++) {
                        const nextItem = textItems[j];

                        if (nextItem === "일반" || nextItem === "특수") {
                            orderType = nextItem;
                            
                            // '일반' 단어 주변 앞뒤에 위치한 진짜 수량(숫자) 수집
                            if (textItems[j-1] && /^\d+$/.test(textItems[j-1])) {
                                quantity = textItems[j-1];
                            } else if (textItems[j-2] && /^\d+$/.test(textItems[j-2])) {
                                quantity = textItems[j-2];
                            } else if (textItems[j+1] && /^\d+$/.test(textItems[j+1])) {
                                quantity = textItems[j+1];
                            }
                            break;
                        }
                    }

                    // 💡 오직 원주문구분이 '일반'인 제품만 최종 목록에 등록
                    if (orderType === "일반") {
                        // 모델명 뒤의 유통 코드(.AKOR 등) 제거
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
                        👷 <b>1. 설치기사 :</b> <span style="font-size:16px; color:#1e1b4b; font-weight:bold;">${technician} 기사님</span>
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
                        👷 <b>1. 설치기사 :</b> <span style="font-weight:bold;">${technician}</span><br><br>
                        ⚠️ 검수 대상 제품(원주문구분: 일반)이 없거나 순수 자재 코드만 존재하여 품목이 등록되지 않았습니다.
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
        ocrResultDiv.innerText = "사진 인식 실패 (모델명 수동 입력 검수 가능)";
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
