const BASE_DIMENSIONS = Object.freeze({
  width: 640,
  height: 200,
  paddingX: 18,
  paddingY: 16
});

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePoints(points = [], options = {}) {
  const allowNegative = Boolean(options?.allowNegative);
  if (!Array.isArray(points)) return [];
  return points.map((point, index) => ({
    label: String(point?.label || `${index + 1}`),
    value: allowNegative
      ? (Number.isFinite(Number(point?.value)) ? Number(point.value) : 0)
      : Math.max(0, Number(point?.value || 0))
  }));
}

function resolveLabelStep(totalPoints, requestedStep = 'auto') {
  if (Number.isFinite(Number(requestedStep)) && Number(requestedStep) > 0) {
    return Math.max(1, Math.floor(Number(requestedStep)));
  }
  if (totalPoints <= 8) return 1;
  if (totalPoints <= 16) return 2;
  if (totalPoints <= 30) return 4;
  return Math.max(1, Math.ceil(totalPoints / 8));
}

export function buildGestionLineGraph(options = {}) {
  const allowNegative = Boolean(options?.allowNegative);
  const normalizedPoints = normalizePoints(options.points, { allowNegative });
  if (!normalizedPoints.length) {
    return `<p class="module-placeholder">${escapeHtml(options.emptyMessage || 'Aucune donnee disponible.')}</p>`;
  }

  const width = Number.isFinite(Number(options.width))
    ? Number(options.width)
    : BASE_DIMENSIONS.width;
  const height = Number.isFinite(Number(options.height))
    ? Number(options.height)
    : BASE_DIMENSIONS.height;
  const paddingX = Number.isFinite(Number(options.paddingX))
    ? Number(options.paddingX)
    : BASE_DIMENSIONS.paddingX;
  const paddingY = Number.isFinite(Number(options.paddingY))
    ? Number(options.paddingY)
    : BASE_DIMENSIONS.paddingY;
  const innerWidth = Math.max(1, width - paddingX * 2);
  const innerHeight = Math.max(1, height - paddingY * 2);
  const rawValues = normalizedPoints.map(point => point.value);
  const maxValue = allowNegative ? Math.max(0, ...rawValues) : Math.max(1, ...rawValues);
  const minValue = allowNegative ? Math.min(0, ...rawValues) : 0;
  const range = Math.max(1, maxValue - minValue);
  const stepX = normalizedPoints.length > 1 ? innerWidth / (normalizedPoints.length - 1) : innerWidth;
  const labelStep = resolveLabelStep(normalizedPoints.length, options.labelStep);
  const gridRows = Number.isFinite(Number(options.gridRows))
    ? Math.max(0, Math.floor(Number(options.gridRows)))
    : 4;

  const coords = normalizedPoints.map((point, index) => {
    const x = paddingX + stepX * index;
    const y = paddingY + innerHeight - ((point.value - minValue) / range) * innerHeight;
    return { ...point, x, y };
  });

  const linePath = coords
    .map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x} ${coord.y}`)
    .join(' ');
  const areaPath = `${linePath} L ${paddingX + innerWidth} ${paddingY + innerHeight} L ${paddingX} ${paddingY + innerHeight} Z`;
  const gridMarkup = Array.from({ length: gridRows }, (_unused, index) => {
    const ratio = (index + 1) / (gridRows + 1);
    const y = paddingY + innerHeight * ratio;
    return `<line class="gestion-graph-grid" x1="${paddingX}" y1="${y}" x2="${paddingX + innerWidth}" y2="${y}"></line>`;
  }).join('');
  const zeroLineMarkup =
    allowNegative && minValue < 0 && maxValue > 0
      ? (() => {
          const zeroY = paddingY + innerHeight - ((0 - minValue) / range) * innerHeight;
          return `<line class="gestion-graph-grid gestion-graph-grid--zero" x1="${paddingX}" y1="${zeroY}" x2="${paddingX + innerWidth}" y2="${zeroY}"></line>`;
        })()
      : '';
  const labelsMarkup = coords
    .map((coord, index) =>
      index % labelStep === 0 || index === coords.length - 1
        ? `<span>${escapeHtml(coord.label)}</span>`
        : '<span aria-hidden="true"></span>'
    )
    .join('');

  const intent = String(options.intent || 'accent').trim().toLowerCase();
  const pointRadius = Number.isFinite(Number(options.pointRadius))
    ? Math.max(0, Number(options.pointRadius))
    : 3.2;
  const showArea = options.showArea !== false;
  const showPoints = options.showPoints !== false;
  const showLabels = options.showLabels !== false;
  const ariaLabel = escapeHtml(options.ariaLabel || 'Evolution');

  return `
    <div class="gestion-graph-shell" data-graph-intent="${escapeHtml(intent)}">
      <svg class="gestion-graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}">
        ${gridMarkup}
        ${zeroLineMarkup}
        ${showArea ? `<path class="gestion-graph-area" d="${areaPath}"></path>` : ''}
        <path class="gestion-graph-line" d="${linePath}"></path>
        ${
          showPoints
            ? coords
                .map(
                  coord => `
                    <circle class="gestion-graph-point" cx="${coord.x}" cy="${coord.y}" r="${pointRadius}">
                      <title>${escapeHtml(`${coord.label}: ${coord.value}`)}</title>
                    </circle>
                  `
                )
                .join('')
            : ''
        }
      </svg>
      ${showLabels ? `<div class="gestion-graph-labels">${labelsMarkup}</div>` : ''}
    </div>
  `;
}
