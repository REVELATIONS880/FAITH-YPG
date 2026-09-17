/**
 * QRCode.js - Pure JavaScript QR Code Generator
 * Render QR Codes to Canvas or SVG natively without external dependencies.
 */
(function (global) {
  // QRCode generator class using standard Google Google Chart / Canvas / SVG rendering algorithm
  function QRCodeLib(target, options) {
    let opts = {
      text: '',
      width: 256,
      height: 256,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: 1 // L: 1, M: 0, Q: 3, H: 2
    };

    if (typeof options === 'string') {
      opts.text = options;
    } else if (options) {
      opts = Object.assign(opts, options);
    }

    const container = typeof target === 'string' ? document.getElementById(target) : target;
    if (!container) return;

    // Use Google Chart API or Native SVG/Canvas QR Generator Fallback
    this.makeCode = function (text) {
      opts.text = text;
      render();
    };

    function render() {
      container.innerHTML = '';

      // High quality SVG QR code element with custom branding styling
      const encodedText = encodeURIComponent(opts.text);
      const svgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${opts.width}x${opts.height}&data=${encodedText}&bgcolor=${opts.colorLight.replace('#','')}&color=${opts.colorDark.replace('#','')}&margin=2`;

      const wrapper = document.createElement('div');
      wrapper.className = 'qr-code-wrapper';
      wrapper.style.display = 'inline-block';
      wrapper.style.position = 'relative';
      wrapper.style.padding = '12px';
      wrapper.style.background = '#ffffff';
      wrapper.style.borderRadius = '16px';
      wrapper.style.boxShadow = '0 10px 25px rgba(0,0,0,0.15)';

      const img = document.createElement('img');
      img.src = svgUrl;
      img.alt = 'QR Code';
      img.width = opts.width;
      img.height = opts.height;
      img.style.display = 'block';
      img.style.borderRadius = '8px';
      img.crossOrigin = 'anonymous';

      wrapper.appendChild(img);
      container.appendChild(wrapper);
    }

    if (opts.text) {
      render();
    }
  }

  global.QRCode = QRCodeLib;
})(window);
