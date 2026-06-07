// [당시 문제가 되었던 기사 및 모델명 추출 루프 영역]
const textData = await page.getTextContent();
const textItems = textData.items.map(item => {
    return item.str.replace(/[\r\n\t"']/g, '').trim();
}).filter(item => item !== "");

let technician = "미확인";
let orderItems = [];
targetModels = [];

// ❌ 문제가 되었던 구간: 문서 전체를 루프 돌면서 매칭
for (let i = 0; i < textItems.length; i++) {
    // 1. 설치기사 이름 찾기 시도
    if (textItems[i] === "설치기사") {
        if (textItems[i+1]) {
            technician = textItems[i+1]; // 여기서 처음에는 '강정환'을 잘 잡았으나...
        }
    }
    
    // 이 뒤에 전체 문서 루프를 계속 돌면서 하단에 나오는 '고객명', '연락처' 단어 배열이나 
    // 정규식 매칭이 꼬여 최종적으로 technician 변수가 다른 값으로 덮어씌워짐.
    
    // 2. 모델명 패턴 분석 및 자재 필터 구간
    const item = textItems[i];
    if (/^[A-Z]{2,4}\d+[A-Z0-9-_.]+/i.test(item)) {
        const upperItem = item.toUpperCase();

        // P로 시작하는 자재 차단 시도
        if (upperItem.startsWith('P') && !upperItem.startsWith('PQ')) {
            continue; 
        }

        let quantity = "1"; 
        let orderType = "미확인";
        let location = "공란(미지정)";

        // '일반' 단어 추적 및 수량 수집
        for (let j = i + 1; j < Math.min(i + 15, textItems.length); j++) {
            const nextItem = textItems[j];
            if (nextItem === "일반" || nextItem === "특수") {
                orderType = nextItem;
                if (textItems[j-1] && /^\d+$/.test(textItems[j-1])) quantity = textItems[j-1];
                break;
            }
        }

        if (orderType === "일반") {
            let cleanModel = item.split('.')[0].trim().toUpperCase();
            targetModels.push(cleanModel);
            orderItems.push({ model: cleanModel, qty: quantity, type: orderType, loc: location });
        }
    }
}
