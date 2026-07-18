const MARGIN_MAP = {
    0: { label: 'TooEarly', color: '#FF0000' },
    1: { label: 'VeryEarly', color: '#FF6F4E' },
    2: { label: 'EarlyPerfect', color: '#A0FF4E' },
    3: { label: 'Perfect', color: '#60FF4E' },
    4: { label: 'LatePerfect', color: '#A0FF4E' },
    5: { label: 'VeryLate', color: '#FF6F4E' },
    6: { label: 'TooLate', color: '#FF0000' },
    7: { label: 'Multipress', color: '#00FFED' },
    8: { label: 'FailMiss', color: '#D958FF' },
    9: { label: 'FailOverload', color: '#D958FF' },
    10: { label: 'Auto', color: '#FFFFFF' },
    11: { label: 'OverPress', color: '#D958FF' }
};

const DISPLAY_ORDER = [9, 0, 1, 2, 3, 4, 5, 7, 8];
let showDynamicAvg = false;

const JD_WEIGHTS = {
    "failMiss": 0.0,
    "tooEarly": 0.2,
    "early": 0.4,
    "ePerfect": 0.75,
    "perfect": 1.0,
    "lPerfect": 0.75,
    "late": 0.4
};



let globalOffsets = [];
let globalAvg = 0;
let globalStdDev = 0;
let globalCounts = {};
let myChart = null;
let distributionChart = null;



function gaussianPDF(x, mean, stdDev) {
    const coefficient = 1 / (stdDev * Math.sqrt(2 * Math.PI));
    const exponent = -0.5 * Math.pow((x - mean) / stdDev, 2);
    return coefficient * Math.exp(exponent);
}

function calculateStatistics() {
    const validOffsets = globalOffsets.map(item => item[0]).filter(val => !isNaN(val));
    const n = validOffsets.length;
    
    if (n === 0) return { mean: 0, stdDev: 0 };
    
    const mean = validOffsets.reduce((a, b) => a + b, 0) / n;
    const variance = validOffsets.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    
    return { mean, stdDev };
}

function createHistogramData(offsets, binCount = 60) {
    const validOffsets = offsets.map(item => item[0]).filter(val => !isNaN(val));
    if (validOffsets.length === 0) return [];
    
    const min = Math.min(...validOffsets);
    const max = Math.max(...validOffsets);
    
    const padding = (max - min) * 0.05;
    const extendedMin = min - padding;
    const extendedMax = max + padding;
    const range = extendedMax - extendedMin;
    const binWidth = range / binCount;
    
    const bins = [];
    for (let i = 0; i < binCount; i++) {
        const binStart = extendedMin + i * binWidth;
        const binEnd = binStart + binWidth;
        const binCenter = (binStart + binEnd) / 2;
        bins.push({
            start: binStart,
            end: binEnd,
            center: binCenter,
            count: 0
        });
    }
    
    validOffsets.forEach(offset => {
        let binIndex = Math.floor((offset - extendedMin) / binWidth);
        if (binIndex >= binCount) binIndex = binCount - 1;
        if (binIndex < 0) binIndex = 0;
        bins[binIndex].count++;
    });
    
    return bins;
}

function renderDistributionChart() {
    if (globalOffsets.length === 0) return;
    
    const stats = calculateStatistics();
    globalStdDev = stats.stdDev;
    
    const histogramData = createHistogramData(globalOffsets, 60);
    
    const normalCurveData = [];
    if (globalStdDev > 0) {
        const xMin = histogramData[0].start;
        const xMax = histogramData[histogramData.length - 1].end;
        const step = (xMax - xMin) / 200;
        
        const maxCount = Math.max(...histogramData.map(bin => bin.count), 1);
        const scaleFactor = maxCount / gaussianPDF(globalAvg, globalAvg, globalStdDev);
        
        for (let x = xMin; x <= xMax; x += step) {
            normalCurveData.push({
                x: x,
                y: gaussianPDF(x, globalAvg, globalStdDev) * scaleFactor
            });
        }
    }
    
    const distStatsContainer = document.getElementById('distributionStats');
    distStatsContainer.innerHTML = `
        <div class="dist-stat-item">
            <div class="label">平均值 (μ)</div>
            <div class="value" style="color: #ffffff;">${globalAvg.toFixed(2)} ms</div>
        </div>
        <div class="dist-stat-item">
            <div class="label">标准差 (σ)</div>
            <div class="value" style="color: #ffffff;">${globalStdDev.toFixed(2)} ms</div>
        </div>
        <div class="dist-stat-item">
            <div class="label">偏度</div>
            <div class="value" style="color: #ffffff;" id="skewnessValue">-</div>
        </div>
        <div class="dist-stat-item">
            <div class="label">峰度</div>
            <div class="value" style="color: #ffffff;" id="kurtosisValue">-</div>
        </div>
    `;
    
    const validOffsets = globalOffsets.map(item => item[0]).filter(val => !isNaN(val));
    if (validOffsets.length > 0 && globalStdDev > 0) {
        const n = validOffsets.length;
        const mean = globalAvg;
        
        const skewness = validOffsets.reduce((sum, val) => sum + Math.pow((val - mean) / globalStdDev, 3), 0) / n;
        document.getElementById('skewnessValue').textContent = skewness.toFixed(3);
        
        const kurtosis = validOffsets.reduce((sum, val) => sum + Math.pow((val - mean) / globalStdDev, 4), 0) / n - 3;
        document.getElementById('kurtosisValue').textContent = kurtosis.toFixed(3);
    }
    
    if (distributionChart) {
        distributionChart.destroy();
    }
    
    const ctx = document.getElementById('distributionChart').getContext('2d');
    
    const xMin = histogramData[0].start;
    const xMax = histogramData[histogramData.length - 1].end;
    
    const annotationsConfig = {
        meanLine: {
            type: 'line',
            xMin: globalAvg,
            xMax: globalAvg,
            borderColor: '#ffb74d',
            borderWidth: 2,
            borderDash: [5, 5],
            label: {
                display: true,
                content: `μ = ${globalAvg.toFixed(2)}`,
                position: 'start',
                backgroundColor: 'rgba(230, 124, 11, 0.8)',
                color: '#fff',
                font: { size: 10, weight: 'bold' },
                yAdjust: -10
            }
        }
    };
    
    if (globalStdDev > 0) {
        annotationsConfig.oneSigmaPlus = {
            type: 'line',
            xMin: globalAvg + globalStdDev,
            xMax: globalAvg + globalStdDev,
            borderColor: 'rgba(79, 195, 247, 0.6)',
            borderWidth: 1.5,
            borderDash: [3, 3],
            label: {
                display: true,
                content: `+1σ`,
                position: 'start',
                backgroundColor: 'rgba(79, 195, 247, 0.7)',
                color: '#fff',
                font: { size: 9 },
                yAdjust: -10
            }
        };
        
        annotationsConfig.oneSigmaMinus = {
            type: 'line',
            xMin: globalAvg - globalStdDev,
            xMax: globalAvg - globalStdDev,
            borderColor: 'rgba(79, 195, 247, 0.6)',
            borderWidth: 1.5,
            borderDash: [3, 3],
            label: {
                display: true,
                content: `-1σ`,
                position: 'start',
                backgroundColor: 'rgba(79, 195, 247, 0.7)',
                color: '#fff',
                font: { size: 9 },
                yAdjust: -10
            }
        };
    }
    
    distributionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            datasets: [
                {
                    label: '偏移量分布',
                    data: histogramData.map(bin => ({ x: bin.center, y: bin.count })),
                    backgroundColor: 'rgba(76, 175, 80, 0.6)',
                    borderColor: 'rgba(76, 175, 80, 0.8)',
                    borderWidth: 1,
                    order: 2,
                    barPercentage: 1.0,
                    categoryPercentage: 1.0,
                },
                {
                    label: '正态分布拟合',
                    data: normalCurveData,
                    type: 'line',
                    borderColor: '#ffb74d',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.4,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            layout: {
                padding: {
                    top: 25,
                    right: 15,
                    bottom: 5,
                    left: 15
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    min: xMin,
                    max: xMax,
                    title: { display: true, text: '偏移量 (ms)', color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { 
                        color: '#bbb',
                        maxTicksLimit: 10,
                        callback: function(value) {
                            return value.toFixed(1);
                        }
                    }
                },
                y: {
                    title: { display: true, text: '频次', color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb' },
                    beginAtZero: true
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#fff', boxWidth: 12, font: { size: 10 }, padding: 15 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                return `频次: ${context.raw.y}`;
                            } else {
                                return `正态拟合值: ${context.raw.y.toFixed(2)}`;
                            }
                        }
                    }
                },
                annotation: {
                    annotations: annotationsConfig
                }
            }
        }
    });
}

function renderScatterChart() {
    if (globalOffsets.length === 0) return;
    
    const numContainer = document.getElementById('pureNumbersContainer');
    numContainer.innerHTML = '';
    DISPLAY_ORDER.forEach(type => {
        const count = globalCounts[type];
        const span = document.createElement('span');
        span.className = 'pure-number';
        span.style.color = MARGIN_MAP[type].color;
        span.innerText = count;
        span.title = MARGIN_MAP[type].label; 
        numContainer.appendChild(span);
    });
    

    const datasetsMap = {};
    DISPLAY_ORDER.forEach(i => {
        datasetsMap[i] = {
            label: MARGIN_MAP[i].label,
            data: [],
            borderColor: MARGIN_MAP[i].color,
            backgroundColor: MARGIN_MAP[i].color + 'CC',
            pointRadius: 3,
            pointHoverRadius: 6,
            showLine: false,
            parsing: false,
            normalized: true
        };
    });

    for (let index = 0; index < globalOffsets.length; index++) {
        const item = globalOffsets[index];
        const yOffset = item[0];
        const marginType = item[1];
        if (datasetsMap[marginType]) {
            datasetsMap[marginType].data.push({ x: index + 1, y: yOffset });
        }
    }

    const finalDatasets = Object.values(datasetsMap);

    if (globalOffsets.length > 0) {
        const avgLineData = [];
        let runningSum = 0;
        let runningCount = 0;

        for (let index = 0; index < globalOffsets.length; index++) {
            const yOffset = globalOffsets[index][0];
            if (!isNaN(yOffset)) {
                runningSum += yOffset;
                runningCount++;
                avgLineData.push({ x: index + 1, y: runningSum / runningCount });
            }
        }

        finalDatasets.push({
            label: '动态 Avg 曲线',
            type: 'line',
            data: avgLineData,
            borderColor: '#ffb74d',
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0.1,
            showLine: true,
            hidden: !showDynamicAvg 
        });
    }
    
    if (myChart) {
        myChart.destroy();
    }

    const ctx = document.getElementById('scatterChart').getContext('2d');
    
    myChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: finalDatasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            spanGaps: true,
            scales: {
                x: {
                    title: { display: true, text: '按键顺序 (Hit Index)', color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb' }
                },
                y: {
                    title: { display: true, text: '偏移量 (Offset ms)', color: '#aaa' },
                    grid: { color: '#252525' },
                    ticks: { color: '#bbb' }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#fff', boxWidth: 12, font: { size: 10 }, padding: 15 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.raw.x}: ${context.raw.y.toFixed(4)} ms (${context.dataset.label})`;
                        }
                    }
                },
                zoom: {
                    pan: { enabled: true, mode: 'xy', threshold: 5 },
                    zoom: {
                        wheel: { enabled: true, speed: 0.08 },
                        pinch: { enabled: true },
                        mode: 'xy'
                    }
                },
                annotation: {
                    annotations: {
                        line0ms: {
                            type: 'line',
                            yMin: 0,
                            yMax: 0,
                            borderColor: 'rgba(255, 255, 255, 0.75)',
                            borderWidth: 1.5,
                            label: {
                                display: true,
                                content: '0 ms',
                                position: 'start',
                                backgroundColor: 'rgba(0,0,0,0.6)',
                                color: '#fff',
                                font: { size: 10 }
                            }
                        },
                        lineAvg: {
                            type: 'line',
                            yMin: globalAvg,
                            yMax: globalAvg,
                            borderColor: '#ffb74d',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            label: {
                                display: true,
                                content: `Avg: ${globalAvg >= 0 ? '+' : ''}${globalAvg.toFixed(2)}`,
                                position: 'end',
                                backgroundColor: 'rgba(230, 124, 11, 0.8)',
                                color: '#fff',
                                font: { size: 10, weight: 'bold' }
                            }
                        }
                    }
                }
            }
        }
    });
}

function updateAllCharts() {
    renderScatterChart();
    renderDistributionChart();
}

document.getElementById('jsonFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const data = JSON.parse(evt.target.result);
            if (!data.offsets) {
                alert("无效的 JSON 数据");
                return;
            }
            
            let parsedOffsets = [];
            if (Array.isArray(data.offsets)) {
                parsedOffsets = data.offsets;
                document.getElementById('fileVersion').innerText = "Version: 1.7.1+";
            } else if (typeof data.offsets === 'object' && data.offsets !== null) {
                const sortedKeys = Object.keys(data.offsets).sort((a, b) => parseInt(a) - parseInt(b));
                parsedOffsets = sortedKeys.map(key => {
                    const node = data.offsets[key];
                    return [node.v, node.j];
                });
                document.getElementById('fileVersion').innerText = "Version: 1.7.0";
            } else {
                alert("未识别的 offsets 数据格式！");
                return;
            }

            globalOffsets = parsedOffsets;
            
            document.getElementById('metaInfo').innerHTML = `
                <strong>谱面歌名:</strong> ${data.songName || 'Unknown'}<br>
                <strong>文件路径:</strong> ${data.levelPath || 'Unknown'}<br>
                <strong>分析时间:</strong> ${data.timestamp ? new Date(data.timestamp * 1000).toLocaleString() : 'Unknown'}
            `;

            calculateStaticStats();
            updateAllCharts();
        } catch (err) {
            alert("JSON 解析失败，请检查文件结构。");
            console.error(err);
        }
    };
    reader.readAsText(file);
});

function calculateStaticStats() {
    const totalHits = globalOffsets.length;
    const validOffsets = globalOffsets.map(item => item[0]).filter(val => !isNaN(val));
    
    globalAvg = totalHits > 0 ? (validOffsets.reduce((a, b) => a + b, 0) / totalHits) : 0;
    
    if (totalHits > 0) {
        const variance = validOffsets.reduce((sum, val) => sum + Math.pow(val - globalAvg, 2), 0) / totalHits;
        globalStdDev = Math.sqrt(variance);
    } else {
        globalStdDev = 0;
    }

    for (let i = 0; i <= 11; i++) globalCounts[i] = 0;
    globalOffsets.forEach(item => {
        const marginType = item[1];
        if (globalCounts[marginType] !== undefined) globalCounts[marginType]++;
    });

    const failMissSum = globalCounts[8] + globalCounts[9]; 
    const judgementsArray = [
        failMissSum,   
        globalCounts[0],     
        globalCounts[1],     
        globalCounts[2],     
        globalCounts[3],     
        globalCounts[4],     
        globalCounts[5]      
    ];
    const xacc = calcXACC(judgementsArray);

    document.getElementById('statTotal').innerText = totalHits.toLocaleString();
    document.getElementById('statAvg').innerText = `${globalAvg >= 0 ? '+' : ''}${globalAvg.toFixed(2)} ms`;
    document.getElementById('xaccValue').innerText = `XACC: ${(xacc * 100).toFixed(2)}%`;
}

function calcXACC(judgements) {
    if (judgements.length !== 7 || judgements.reduce((a, b) => a + b, 0) === 0) {
        return 0.0;
    }
    const total = judgements.reduce((a, b) => a + b, 0);
    const keys = ["failMiss", "tooEarly", "early", "ePerfect", "perfect", "lPerfect", "late"];
    
    let weightedSum = 0;
    for (let i = 0; i < 7; i++) {
        weightedSum += judgements[i] * JD_WEIGHTS[keys[i]];
    }
    return weightedSum / total;
}

document.getElementById('resetZoom').addEventListener('click', () => {
    if (myChart) {
        myChart.resetZoom();
    }
});