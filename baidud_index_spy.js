// ==UserScript==
// @name         Catweb(百度指数嗅探导出)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动嗅探，自动解密，自动生成真实日期序列 (支持日/周级数据)，一键导出 CSV
// @author       Gemini & Ask-Suzumi
// @match        *://index.baidu.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ================= 全局存储区 =================
    window.BD_DATA = {
        key: null,
        indexData: null,
        type: null // 'search' 或 'news'
    };

    // ================= 1. 网络拦截核心 (XHR Hook) =================
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const _this = this;
        this.addEventListener('load', function() {
            try {
                // 拦截 秘钥 (ptbk)
                if (_this._url.includes('Interface/ptbk')) {
                    const res = JSON.parse(_this.responseText);
                    if (res.status === 0) {
                        window.BD_DATA.key = res.data;
                        updateStatus(`🔑 秘钥已更新`);
                        checkReady();
                    }
                }
                // 拦截 搜索指数
                if (_this._url.includes('SearchApi/index')) {
                    const res = JSON.parse(_this.responseText);
                    if (res.status === 0) {
                        window.BD_DATA.indexData = res.data;
                        window.BD_DATA.type = 'search';
                        updateStatus(`📊 搜索指数已捕获`);
                        checkReady();
                    }
                }
                // 拦截 资讯指数
                if (_this._url.includes('FeedSearchApi/getFeedIndex')) {
                    const res = JSON.parse(_this.responseText);
                    if (res.status === 0) {
                        window.BD_DATA.indexData = res.data;
                        window.BD_DATA.type = 'news';
                        updateStatus(`📰 资讯指数已捕获`);
                        checkReady();
                    }
                }
            } catch (e) { /* 忽略非相关请求报错 */ }
        });
        return originalSend.apply(this, arguments);
    };

    // ================= 2. 核心算法工具 =================
    
    // 解密
    function decrypt(key, data) {
        let n = {};
        let s = [];
        let half = Math.floor(key.length / 2);
        for (let i = 0; i < half; i++) n[key[i]] = key[half + i];
        for (let i = 0; i < data.length; i++) s.push(n[data[i]] || data[i]);
        return s.join("").split(",");
    }

    // 日期解析 (解决时区偏移问题)
    function parseDate(str) {
        // str format: "2024-01-01"
        if (!str) return new Date();
        const parts = str.split('-');
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    // 日期格式化
    function formatDate(date) {
        const y = date.getFullYear();
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const d = date.getDate().toString().padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // ================= 3. UI 界面 =================
    let panel, statusDiv, exportBtn;

    function createUI() {
        panel = document.createElement('div');
        panel.style.cssText = `
            position: fixed; top: 100px; right: 20px; z-index: 999999;
            background: white; padding: 15px; border-radius: 8px;
            box-shadow: 0 0 15px rgba(0,0,0,0.2); width: 200px;
            font-family: sans-serif; border-left: 5px solid #4e6ef2;
        `;
        
        const title = document.createElement('div');
        title.innerHTML = "<b>📅 百度指数导出助手</b>";
        title.style.marginBottom = "8px";

        statusDiv = document.createElement('div');
        statusDiv.innerHTML = "⏳ 等待数据刷新...";
        statusDiv.style.fontSize = "12px";
        statusDiv.style.color = "#666";
        statusDiv.style.marginBottom = "10px";

        exportBtn = document.createElement('button');
        exportBtn.innerHTML = "禁止导出 (无数据)";
        exportBtn.disabled = true;
        exportBtn.style.cssText = `
            width: 100%; padding: 8px; background: #ccc; color: white;
            border: none; border-radius: 4px; cursor: not-allowed; font-weight: bold;
        `;
        exportBtn.onclick = exportCSV;

        panel.appendChild(title);
        panel.appendChild(statusDiv);
        panel.appendChild(exportBtn);
        document.body.appendChild(panel);
    }

    function updateStatus(msg) {
        if(statusDiv) statusDiv.innerHTML = `✓ ${msg}`;
    }

    function checkReady() {
        if (window.BD_DATA.key && window.BD_DATA.indexData) {
            exportBtn.disabled = false;
            exportBtn.innerHTML = "📥 导出 CSV (带日期)";
            exportBtn.style.background = "#4e6ef2";
            exportBtn.style.cursor = "pointer";
        }
    }

    // ================= 4. 导出逻辑 (含日期计算) =================
    function exportCSV() {
        try {
            const { key, indexData, type } = window.BD_DATA;
            let results = {};
            let dateInfo = {};
            let typeName = type === 'search' ? '搜索指数' : '资讯指数';

            // A. 解析数据
            let items = type === 'search' ? indexData.userIndexes : indexData.index;
            // 获取时间范围信息
            if (type === 'search') dateInfo = items[0].all;
            else dateInfo = items[0]; 

            // 遍历解密
            items.forEach(item => {
                let word = "";
                let encrypted = "";
                if (type === 'search') {
                    word = item.word[0].name;
                    encrypted = item.all.data;
                } else {
                    word = Array.isArray(item.key) ? item.key[0].name : String(item.key);
                    encrypted = item.data;
                }
                
                // 解密并清洗空值
                let decrypted = decrypt(key, encrypted);
                results[word] = decrypted.map(v => v === "" ? "0" : v);
            });

            // B. 生成日期序列 (核心算法)
            const startDateStr = dateInfo.startDate;
            const endDateStr = dateInfo.endDate;
            
            if (!startDateStr || !endDateStr) {
                alert("无法获取开始/结束日期，将使用序号代替。");
            }

            const keywords = Object.keys(results);
            const dataCount = results[keywords[0]].length;
            
            // 计算步长 (Step)
            // 如果 count ≈ days + 1，步长为1天
            // 如果 count ≈ (days / 7)，步长为7天
            let dateList = [];
            if (startDateStr && endDateStr) {
                const startObj = parseDate(startDateStr);
                const endObj = parseDate(endDateStr);
                const totalDays = (endObj - startObj) / (1000 * 60 * 60 * 24);
                
                // 智能推算步长 (天数差 / (数据点数 - 1))
                let step = Math.round(totalDays / (dataCount - 1));
                if (step < 1) step = 1; // 防止除以0
                
                console.log(`检测到数据: ${dataCount}个点, 总天数: ${totalDays}, 推算步长: ${step}天`);

                for (let i = 0; i < dataCount; i++) {
                    // 创建一个新的日期对象，避免引用修改
                    let d = new Date(startObj); 
                    d.setDate(startObj.getDate() + (i * step));
                    dateList.push(formatDate(d));
                }
            } else {
                // 降级方案
                for(let i=0; i<dataCount; i++) dateList.push(`Day_${i+1}`);
            }

            // C. 组装 CSV
            // BOM头 + 表头
            let csv = "\uFEFF";
            csv += `日期,${keywords.join(",")}\n`;

            for (let i = 0; i < dataCount; i++) {
                let row = `${dateList[i]}`; // 第一列是日期
                keywords.forEach(w => {
                    row += `,${results[w][i]}`;
                });
                csv += row + "\n";
            }

            // D. 下载
            const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            
            let kwName = keywords.length > 3 ? `${keywords[0]}_等${keywords.length}词` : keywords.join("_");
            link.href = url;
            link.download = `百度${typeName}_${kwName}_${startDateStr}_${endDateStr}.csv`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            updateStatus("✅ 导出成功！");

        } catch (e) {
            console.error(e);
            alert("导出失败: " + e.message);
        }
    }

    window.addEventListener('load', createUI);


})();
