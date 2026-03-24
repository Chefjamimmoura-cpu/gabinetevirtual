export function smartTitleCase(text: string): string {
  if (!text) return '';

  // Lista de Siglas Legislativas/Locais e Preposições
  const preserveAcronyms = ['PL', 'LOA', 'LDO', 'PPA', 'VET', 'PRE', 'REQ', 'PDL', 'PLC', 'MOC', 'IND', 'STF', 'STJ', 'TCE', 'TCU', 'RR', 'CMBV', 'PMBV', 'SUS', 'ECA', 'CLT', 'CTB', 'CPF', 'CNPJ', 'RG'];
  const lowerCaseWords = ['e', 'o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com'];

  // Função auxiliar para capitalizar uma palavra
  const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

  return text
    .split(' ')
    .map((word, index) => {
      const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ''); // Remove pontuação para checar sigla
      
      // Preservar siglas exatamente como estão na lista (ignorando case original para fazer o match)
      const isAcronym = preserveAcronyms.find(a => a.toLowerCase() === cleanWord.toLowerCase());
      if (isAcronym) {
        // Retorna a palavra original trocando a parte da sigla pela versão oficial maiúscula
        return word.replace(new RegExp(cleanWord, 'i'), isAcronym);
      }

      // Preposições minúsculas (se não for a primeira palavra)
      if (index !== 0 && lowerCaseWords.includes(word.toLowerCase())) {
        return word.toLowerCase();
      }

      // Palavras normais capitalizadas
      return capitalize(word);
    })
    .join(' ');
}
