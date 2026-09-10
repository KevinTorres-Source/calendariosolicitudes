const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/app.js'), 'utf8');
function funcion(nombre) {
  const inicio = source.search(new RegExp(`(?:async )?function ${nombre}\\(`));
  assert(inicio >= 0, nombre);
  const resto = source.slice(inicio);
  const fin = resto.slice(1).search(/\n(?:async )?function /);
  return fin < 0 ? resto : resto.slice(0, fin + 1);
}
function entorno() {
  let html = '';
  const reservas = [{usuario:'Ana María', correo:'ana@example.test', creadoEn:'2026-08-03T12:00:00Z', fecha:'2026-08-10', etiqueta:{nombre:'INTERNA'}, objetivoUso:'DETALLE_PRIVADO'}];
  const feedback = [{creadoEn:'2026-08-02T12:00:00Z', eficienciaPrestamo:5}, {creadoEn:'2026-08-03T12:00:00Z', eficienciaPrestamo:5}, {creadoEn:'2026-07-03T12:00:00Z', eficienciaPrestamo:1}];
  const contexto = {
    URL, console, modoAdmin:true, requestsAnalyticsMonth:'2026-08',
    document:{getElementById:()=>({textContent:''})},
    window:{location:{href:'http://localhost:3000/index.html'},open:()=>({document:{open(){},write(value){html=value},close(){}},close(){}})},
    obtenerFeedbackAdmin:async()=>feedback, obtenerReservas:async()=>reservas,
    obtenerMesCreacionSolicitud:item=>({key:item.creadoEn.slice(0,7)}),
    crearInformeMensualSolicitudes:()=>[{key:'2026-08',label:'agosto de 2026',total:1,secciones:new Map(),asignaturas:new Map(),cursos:new Map()}],
    crearDatosPieDesdeMapa:()=>[], crearDatosSolicitudesMensuales:()=>[{key:'2026-06',value:2},{key:'2026-08',value:1}],
    calcularMetricasFeedback:items=>({tendencia:items.map(i=>({creadoEn:i.creadoEn,promedio:i.eficienciaPrestamo})),conteosGenerales:{5:items.length},totalCalificaciones:items.length,promedioGeneral:5,favorables:100,metricas:[],debilidad:'Servicio'}),
    feedbackRatingValues:[1,2,3,4,5], feedbackPreguntas:[{key:'eficienciaPrestamo'}],
    normalizarFeedbackValor:v=>v??null,formatearRating:String,
    obtenerSeccionReserva:()=>'',obtenerAsignaturaReserva:()=>'',obtenerObjetivoUsoReserva:i=>i.objetivoUso,
    traducirEstadoReporte:()=>'',obtenerTopCategoria:()=>'-',
    excelValor:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
  };
  vm.createContext(contexto);
  for(const nombre of ['tablaExcel','puntoPolar','arcoSvg','graficaPieExcel','graficaBarrasExcel','graficaBarrasHorizontalesExcel','graficaLineaFeedbackExcel','docentesInformePdf','evolucionInformePdf','demandaHorariaInformePdf','graficaComparativaPdf','prioridadesDemandaPdf','exportarAnalyticsPdf']) vm.runInContext(funcion(nombre),contexto);
  return {contexto,reservas,feedback,html:()=>html};
}
test('PDF ejecutivo sin registros individuales; anexo independiente con el histórico',async()=>{
  const e=entorno();await e.contexto.exportarAnalyticsPdf();let html=e.html();
  assert(!html.includes('DETALLE_PRIVADO'));assert(!html.includes('ana@example.test'));assert(!html.includes('INTERNA'));
  assert(html.includes('Ana María'));assert(html.includes('Images/Mini_logo.png'));assert(!html.includes('border-radius:50%; background:#fff'));
  assert(html.includes('Consistencia absoluta en la excelencia del servicio durante el periodo'));
  assert.equal((html.match(/<section class="/g)||[]).length,7);
  assert(html.includes('<ul>'));assert(html.includes('Evolución mensual'));assert(html.includes('<svg'));
  await e.contexto.exportarAnalyticsPdf(true);html=e.html();assert(html.includes('DETALLE_PRIVADO'));assert(html.includes('ana@example.test'));assert(html.includes('Histórico completo'));assert(!html.includes('INTERNA'));
});
test('Comentario de excelencia solo con al menos dos respuestas perfectas del periodo',async()=>{
  const e=entorno();e.feedback[1].eficienciaPrestamo=4;await e.contexto.exportarAnalyticsPdf();assert(!e.html().includes('Consistencia absoluta'));
  e.feedback.splice(1);await e.contexto.exportarAnalyticsPdf();assert(!e.html().includes('Consistencia absoluta'));assert(e.html().includes('Una sola respuesta'));
  e.feedback.splice(0);await e.contexto.exportarAnalyticsPdf();assert(!e.html().includes('Consistencia absoluta'));assert(e.html().includes('Sin datos'));
});
test('Docentes agrupados sin correos visibles y meses intermedios en cero',()=>{
  const e=entorno();const docentes=e.contexto.docentesInformePdf([{usuario:'Ana',correo:'A@TEST'},{usuario:'Ana',correo:'a@test'},{usuario:'oculto@test',correo:'oculto@test'}]);
  assert.equal(docentes[0].nombre,'Ana');assert.equal(docentes[0].total,2);assert.equal(docentes[1].nombre,'Nombre no registrado');
  const meses=e.contexto.evolucionInformePdf([]);assert.equal(meses.length,3);assert.equal(meses[1].value,0);
  const grafica=e.contexto.graficaBarrasExcel('Prueba',[{label:'jul',value:0}]);assert(grafica.includes('height="0.00"'));
});

test('Demanda horaria suma cantidades válidas y no confunde acumulado con inventario', () => {
  const e = entorno();
  const resultado = e.contexto.demandaHorariaInformePdf([
    {hour:'07:15-08:00', cantidad:20}, {hour:'07:15-08:00',cantidad:'15',estado:'rechazado'},
    {hour:'08:00-08:45',cantidad:10}, {hour:'08:00-08:45',cantidad:-1},
    {hour:'08:00-08:45',cantidad:null}, {hour:'',cantidad:30}
  ]);
  assert.equal(resultado.filas[0].horario,'08:00-08:45');
  assert.equal(resultado.filas[0].solicitudes,3); assert.equal(resultado.filas[0].ipads,10);
  assert.equal(resultado.filas[1].ipads,35); assert.equal(resultado.sinCantidad,2); assert.equal(resultado.sinHorario,1);
  const prioridades = e.contexto.prioridadesDemandaPdf(resultado, [{label:'Física',value:5}], [{label:'Secundaria',value:9},{label:'Primaria',value:1}]);
  assert(prioridades[0].includes('07:15-08:00'));assert(prioridades[0].includes('35'));assert(prioridades[1].includes('Física'));assert(prioridades[2].includes('antes de proponer'));
});
test('Porcentajes por sección usan el total del periodo y escapan los nombres', () => {
  const e = entorno();
  const grafica = e.contexto.graficaComparativaPdf('Secciones', [{label:'<Primaria>',value:3},{label:'Secundaria',value:97}], '#1C4169', 100);
  assert(grafica.includes('3,0%'));assert(grafica.includes('97,0%'));assert(grafica.includes('&lt;Primaria>'));
  assert(!e.contexto.graficaComparativaPdf('Secciones', [], '#1C4169', 0).includes('NaN'));
});
