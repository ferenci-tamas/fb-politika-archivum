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
  GraphicComponent,
  LegendComponent
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
  LegendComponent,
  CanvasRenderer
]);

// Hungarian locale for the time axis, so zoomed-in month ticks read as the standard
// Hungarian abbreviations (jan., feb., márc., …) rather than the English defaults.
// Only the `time` section is consulted here: the chart sets its toolbox title and aria
// description explicitly, so no other locale strings are needed.
echarts.registerLocale('HU', {
  time: {
    month: [
      'január', 'február', 'március', 'április', 'május', 'június',
      'július', 'augusztus', 'szeptember', 'október', 'november', 'december'
    ],
    monthAbbr: [
      'jan.', 'feb.', 'márc.', 'ápr.', 'máj.', 'jún.',
      'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'
    ],
    dayOfWeek: [
      'vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'
    ],
    dayOfWeekAbbr: ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo']
  }
});

export default echarts;
