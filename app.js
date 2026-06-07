// PDF.js 기본 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// 💡 대량 의뢰서를 한 장씩 쪼개어 관리하기 위한 전역 상태 변수
let allOrders = [];         // PDF에서 추출한 의뢰서 전체 목록 (1장 = 1개 객체)
let filteredOrders = [];    // 검색어가 적용된 의뢰서 목록
let targetModels = [];      // 현재 화면(현재 장)에 표시된 완제품 모델명 대조군

let currentOrderIndex = 0;  // 현재 스마트폰 화면에 보고 있는 의뢰서 번호 (0부터 시작)

// ==========================================
// 1. PDF 로드 및 "의뢰서 1장씩" 분할 파싱 로직
// ==========================================
document.getElementById("pdfFile").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const orderList = document.getElementById("orderList");
    orderList.innerHTML = "<li style='list-style:none; color:#2563eb; font-weight:bold;'>📄 대량 의뢰서를 한 장씩 분리하여 로딩 중입니다... 잠시만 기다려 주세요.</li>";

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
            
            const pdf = await loadingTask.promise;
            const totalPdfPages = pdf.numPages; // 전체 PDF 장 수
            
            allOrders = []; // 마스터 데이터 초기화

            // 🔄 핵심: 80장의 PDF를 한 장 한 장 순서대로 독립된 의뢰서로 쪼개어 담습니다.
            for (let pageNum = 1; pageNum <= totalPdfPages; pageNum++) {
                try {
                    const page = await pdf.getPage(pageNum);
                    const textData = await page.getTextContent();
                    
                    // 텍스트 기호 찌꺼기 정제
                    const textItems = textData.items.map(item => {
                        if (!item || !item.str) return "";
                        return item.str.replace(/[\r\n\t"']/g, '').trim();
                    }).filter(item => item !== "");

                    if (textItems.length === 0) continue;

                    // 🕵️‍♂️ 해당 장의 [설치기사] 성명 추출
                    let technicianName = "미지정";
                    for (let k = 0; k < textItems.length; k++) {
                        if (textItems[k].includes("설치기사") && textItems[k + 1]) {
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

                    // 🕵️‍♂️ 해당 장의 [고객명] 성명 추출
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

                    // 📋 해당 장 내부의 에어컨 완제품 품목 추출
                    for (let i = 0; i < textItems.length; i++) {
                        const item = textItems[i].replace(/,/g, '').trim();
                        const upperItem = item.toUpperCase();

                        if (/^[A-Z0-9._-]+$/i.test(upperItem)) {
                            if (upperItem.startsWith('PQ')) continue; // 자재 부품 제외
                            if (upperItem.length < 5 || /^\d+$/.test(upperItem)) continue;
                            if (/^\d+-\d+/.test(upperItem)) continue;

                            let quantity = "1";
                            let orderType = "미확인";

                            for (let j = Math.max(0, i - 3); j < Math.min(textItems.length, i + 15); j++) {
                                const checkText = textItems[j];
                                if (checkText.includes("일반") || checkText.includes("특수")) {
                                    orderType = "일반";
                                    if (textItems[j-1] && /^[1-9]$/.test(textItems[j-1].replace(/,/g, '').trim())) quantity = textItems[j-1].replace(/,/g, '').trim();
                                    else if (textItems[j-2] && /^[1-9]$/.test(textItems[j-2].replace(/,/g, '').trim())) quantity = textItems[j-2].replace(/,/g, '').trim();
                                    else if (textItems[j+1] && /^[1-9]$/.test(textItems[j+1].replace(/,/g, '').trim())) quantity = textItems[j+1].replace(/,/g, '').trim();
                                    break;
                                }
                            }

                            if (orderType === "일반") {
                                let cleanModel = upperItem.split('.')[0].trim();
                                if (!cleanModel.startsWith('PQ')) {
                                    products.push({
                                        model: cleanModel,
                                        qty: quantity
                                    });
                                }
                            }
                        }
                    }

                    // 해당 장 내 중복 모델명 청소
                    const uniqueProducts = [];
                    const seenModels = new Set();
                    products.forEach(p => {
                        if (!seenModels.has(p.model)) {
                            seenModels.add(p.model);
                            uniqueProducts.push(p);
                        }
                    });

                    // 📦 완제품 품목이 존재하는 장만 독립된 카드형태로 적재
                    if (uniqueProducts.length > 0) {
                        allOrders.push({
                            pdfPage: pageNum,
                            technician: technicianName,
                            customer: customerName,
                            items: uniqueProducts
                        });
                    }
                } catch (pageError) {
                    console.error(`${pageNum}장 읽기 스킵:`, pageError);
                    continue;
                }
            }

            // 전체 데이터를 필터 타겟에 복사 후 0번째(첫 장) 활성화
            filteredOrders = [...allOrders];
