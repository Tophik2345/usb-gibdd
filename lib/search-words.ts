/** Match common Russian inflections, while leaving short words and identifiers literal. */
export function searchWords(query: string): string[] {
  return query.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim().split(/\s+/u).map(word =>
    /^[а-я]{5,}$/u.test(word) ? word.replace(/(иями|ями|ами|ого|ему|ому|ыми|ими|ая|яя|ое|ее|ые|ие|ию|ия|ую|юю|ий|ый|ой|ов|ев|ам|ям|ах|ях|ом|ем|а|я|ы|и|у|ю|е|о)$/u, '') : word);
}
