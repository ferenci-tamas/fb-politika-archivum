// Tree-shaken ECharts build for the Elemzés chart. Imported dynamically from
// line-chart.js, so Vite emits it as a separate chunk that only downloads when a
// user actually views a chart. The canvas renderer is used so the chart's export
// button can save a raster PNG (the SVG renderer can only export SVG); ECharts
// accounts for devicePixelRatio, so on-screen rendering stays crisp. Title and
// Graphic components are registered for the export-only title + attribution.

import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  ToolboxComponent,
  TitleComponent,
  GraphicComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  ToolboxComponent,
  TitleComponent,
  GraphicComponent,
  CanvasRenderer
]);

export default echarts;
