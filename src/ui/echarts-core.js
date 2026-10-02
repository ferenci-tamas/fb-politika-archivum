// Tree-shaken ECharts build for the Elemzés chart. Imported dynamically from
// line-chart.js, so Vite emits it as a separate chunk that only downloads when a
// user actually views a chart. The SVG renderer gives crisp output and better
// accessibility than canvas, and keeps the look consistent with the rest of the
// app (which is SVG/DOM throughout).

import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent, ToolboxComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, ToolboxComponent, SVGRenderer]);

export default echarts;
