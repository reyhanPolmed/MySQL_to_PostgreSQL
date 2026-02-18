/**
 * SQL Migrator — App Controller
 * Handles UI interactions, file upload, and conversion orchestration.
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const mysqlInput = document.getElementById('mysqlInput');
    const lineCount = document.getElementById('lineCount');
    const btnConvert = document.getElementById('btnConvert');
    const outputSection = document.getElementById('outputSection');
    const pgOutput = document.getElementById('pgOutput');
    const outputLineCount = document.getElementById('outputLineCount');
    const conversionStats = document.getElementById('conversionStats');
    const btnCopy = document.getElementById('btnCopy');
    const btnDownload = document.getElementById('btnDownload');
    const logSection = document.getElementById('logSection');
    const logContent = document.getElementById('logContent');
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');

    // Options
    const optDropIfExists = document.getElementById('optDropIfExists');
    const optCreateSequences = document.getElementById('optCreateSequences');
    const optConvertCharset = document.getElementById('optConvertCharset');
    const optConvertEngine = document.getElementById('optConvertEngine');
    const optConvertBackticks = document.getElementById('optConvertBackticks');
    const optConvertComments = document.getElementById('optConvertComments');

    // ======= Upload Zone Events =======
    uploadZone.addEventListener('click', () => fileInput.click());

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('drag-over');
    });

    uploadZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('drag-over');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) loadFile(file);
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadFile(file);
    });

    function loadFile(file) {
        if (!file.name.match(/\.(sql|txt)$/i)) {
            showToast('Please upload a .sql or .txt file');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            mysqlInput.value = e.target.result;
            updateLineCount();
            updateConvertButton();
            showToast(`Loaded: ${file.name} (${formatBytes(file.size)})`);
        };
        reader.onerror = () => {
            showToast('Error reading file');
        };
        reader.readAsText(file);
    }

    // ======= Input Events =======
    mysqlInput.addEventListener('input', () => {
        updateLineCount();
        updateConvertButton();
    });

    // Allow Tab key in textarea
    mysqlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = mysqlInput.selectionStart;
            const end = mysqlInput.selectionEnd;
            mysqlInput.value = mysqlInput.value.substring(0, start) + '    ' + mysqlInput.value.substring(end);
            mysqlInput.selectionStart = mysqlInput.selectionEnd = start + 4;
        }
    });

    function updateLineCount() {
        const lines = mysqlInput.value ? mysqlInput.value.split('\n').length : 0;
        lineCount.textContent = `${lines} line${lines !== 1 ? 's' : ''}`;
    }

    function updateConvertButton() {
        btnConvert.disabled = !mysqlInput.value.trim();
    }

    // ======= Convert Button =======
    btnConvert.addEventListener('click', () => {
        const options = {
            dropIfExists: optDropIfExists.checked,
            createSequences: optCreateSequences.checked,
            convertCharset: optConvertCharset.checked,
            convertEngine: optConvertEngine.checked,
            convertBackticks: optConvertBackticks.checked,
            convertComments: optConvertComments.checked,
        };

        const converter = new MySQLToPostgresConverter(options);
        const result = converter.convert(mysqlInput.value);

        // Show output
        pgOutput.value = result;
        outputSection.style.display = 'block';

        // Update output line count
        const outLines = result ? result.split('\n').length : 0;
        outputLineCount.textContent = `${outLines} line${outLines !== 1 ? 's' : ''}`;

        // Show stats
        const stats = converter.stats;
        conversionStats.innerHTML = '';
        if (stats.tablesConverted > 0) {
            conversionStats.innerHTML += `<span class="stat-badge">${stats.tablesConverted} table${stats.tablesConverted > 1 ? 's' : ''}</span>`;
        }
        if (stats.insertsConverted > 0) {
            conversionStats.innerHTML += `<span class="stat-badge">${stats.insertsConverted} insert${stats.insertsConverted > 1 ? 's' : ''}</span>`;
        }
        if (stats.dataTypesChanged > 0) {
            conversionStats.innerHTML += `<span class="stat-badge">${stats.dataTypesChanged} type change${stats.dataTypesChanged > 1 ? 's' : ''}</span>`;
        }

        // Show logs
        logContent.innerHTML = '';
        converter.log.forEach(entry => {
            const div = document.createElement('div');
            div.className = `log-entry log-${entry.type}`;

            const icons = {
                info: 'ℹ️',
                success: '✅',
                warn: '⚠️',
                change: '🔄',
            };

            div.innerHTML = `
                <span class="log-icon">${icons[entry.type] || 'ℹ️'}</span>
                <span>${escapeHtml(entry.message)}</span>
            `;
            logContent.appendChild(div);
        });
        logSection.style.display = 'block';

        // Scroll to output
        outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        showToast('Conversion complete!');
    });

    // ======= Copy Button =======
    btnCopy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(pgOutput.value);
            showToast('Copied to clipboard!');
        } catch (err) {
            // Fallback
            pgOutput.select();
            document.execCommand('copy');
            showToast('Copied to clipboard!');
        }
    });

    // ======= Download Button =======
    btnDownload.addEventListener('click', () => {
        const blob = new Blob([pgOutput.value], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'postgresql_converted.sql';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Downloaded postgresql_converted.sql');
    });

    // ======= Toast =======
    let toastTimeout;
    function showToast(msg) {
        toastMsg.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // ======= Utilities =======
    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Initialize
    updateLineCount();
    updateConvertButton();
});
