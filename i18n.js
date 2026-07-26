// i18n.js
const I18N_STRINGS = {
    zh: {
        importJson: '导入 JSON', resetZoom: '重置缩放', clear: '清空',
        waitingImport: '等待导入...',
        totalHits: '总按键数', maxCombo: '最大连击数', ur: 'UR (不稳定度)',
        scatterTitle: '偏移量散点图', distTitle: '正态分布图',
        pieTitle: '判定分布比例', xaccTitle: 'XACC变化曲线',
        legendTip: '提示:直接点击图例可切换显示判定类型',
        mean: '平均值 (μ)', stdDev: '标准差 (σ)', skewness: '偏度', kurtosis: '峰度',
        offsetDist: '偏移量分布', normalFit: '正态分布拟合',
        offsetX: '偏移量 (ms)', frequency: '频次', normalFitValue: '正态拟合值',
        keyX: '按键',
        invalidJson: '无效的 JSON 数据',
        unknownFormat: '未识别的 offsets 数据格式！',
        parseFailed: 'JSON 解析失败!',
        songName: '谱面歌名', levelPath: '文件路径', analysisTime: '分析时间'
    },
    en: {
        importJson: 'Import JSON', resetZoom: 'Reset Zoom', clear: 'Clear',
        waitingImport: 'Waiting for import...',
        totalHits: 'Total Hits', maxCombo: 'Max Combo', ur: 'UR (Instability)',
        scatterTitle: 'Offset Scatter Plot', distTitle: 'Normal Distribution',
        pieTitle: 'Judgment Breakdown', xaccTitle: 'XACC Progression',
        legendTip: 'Tip: click a legend item to toggle that judgment type',
        mean: 'Mean (μ)', stdDev: 'Std Dev (σ)', skewness: 'Skewness', kurtosis: 'Kurtosis',
        offsetDist: 'Offset Distribution', normalFit: 'Normal Fit',
        offsetX: 'Offset (ms)', frequency: 'Frequency', normalFitValue: 'Normal fit value',
        keyX: 'Hit',
        invalidJson: 'Invalid JSON data',
        unknownFormat: 'Unrecognized offsets data format!',
        parseFailed: 'JSON parsing failed!',
        songName: 'Song Name', levelPath: 'Level Path', analysisTime: 'Analysis Time'
    },
    kr: {
        importJson: 'JSON 가져오기', resetZoom: '줌 초기화', clear: '비우기',
        waitingImport: '가져오기 대기 중...',
        totalHits: '총 타건 수', maxCombo: '최대 콤보', ur: 'UR (불안정도)',
        scatterTitle: '오프셋 산점도', distTitle: '정규 분포',
        pieTitle: '판정 분포 비율', xaccTitle: 'XACC 변화 곡선',
        legendTip: '팁: 범례를 클릭하면 해당 판정 유형 표시를 전환할 수 있습니다',
        mean: '평균 (μ)', stdDev: '표준편차 (σ)', skewness: '왜도', kurtosis: '첨도',
        offsetDist: '오프셋 분포', normalFit: '정규분포 적합',
        offsetX: '오프셋 (ms)', frequency: '빈도', normalFitValue: '정규 적합값',
        keyX: '타건',
        invalidJson: '잘못된 JSON 데이터',
        unknownFormat: '인식할 수 없는 offsets 데이터 형식입니다!',
        parseFailed: 'JSON 파싱 실패!',
        songName: '곡 이름', levelPath: '파일 경로', analysisTime: '분석 시간'
    }
};