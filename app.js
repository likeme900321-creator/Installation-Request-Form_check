document.getElementById("checkBtn")
.addEventListener("click", function () {

    let model =
        document.getElementById("manualInput")
        .value
        .trim();

    if (model === "") {

        alert("모델명을 입력하세요.");

        return;
    }

    document.getElementById("ocrResult")
        .innerText = model;

});
