// Processo de um trabalho da fila. O servidor abre um destes para cada vídeo
// em andamento, o que permite cancelar (encerrando o processo e os filhos)
// sem derrubar a fila. Conversa com o servidor por mensagens:
//   recebe {job}            → começa
//   envia  {gpu:'pedir'}    → espera {gpu:'ok'} antes de transcrever
//   envia  {gpu:'devolver'} → libera a placa para o próximo vídeo
//   envia  {log|progresso|titulo|idioma|arquivo|fim|erro}
const { processar } = require('./motor');

function pedirGpu() {
  return new Promise(resolve => {
    const ouvir = m => { if (m && m.gpu === 'ok') { process.off('message', ouvir); resolve(); } };
    process.on('message', ouvir);
    process.send({ gpu: 'pedir' });
  });
}

process.once('message', async ({ job }) => {
  try {
    const relatorio = await processar(job, {
      log: texto => process.send({ log: texto }),
      aoProgresso: p => process.send({ progresso: p }),
      aoTitulo: titulo => process.send({ titulo }),
      aoIdioma: info => process.send({ idioma: info }),
      aoArquivo: nome => process.send({ arquivo: nome }),
      comGpu: async fn => {
        await pedirGpu();
        process.send({ progresso: { etapa: 'Transcrevendo', total: 0.08 } });
        try { return await fn(); } finally { process.send({ gpu: 'devolver' }); }
      },
    });
    process.send({ fim: relatorio }, () => process.exit(0));
  } catch (e) {
    process.send({ erro: e.message, detalhe: (e.stderr || '').slice(-1200) }, () => process.exit(1));
  }
});
