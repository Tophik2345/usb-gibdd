export type WorkPhoto = {
  file: string;
  title: string;
  alt: string;
  width: number;
  height: number;
  url?: string;
  caption?: string;
};

// Add only inspected, distinct Russia Online images; preserve user-selected originals.
// Keep each original's provenance and checksum in public/gallery/sources.json.
export const workPhotos: WorkPhoto[] = [
  {
    file: 'dps-on-duty.webp',
    title: 'На службе: общение с водителем',
    alt: 'Два сотрудника ДПС разговаривают с водителем рядом с синим автомобилем и патрульной машиной в «России Онлайн».',
    width: 1810,
    height: 1018,
  },
  {
    file: 'gibdd-classroom.jpg',
    title: 'Подготовка сотрудников ДПС',
    alt: 'Сотрудник ДПС в учебном классе со стендами дорожных знаков в «России Онлайн».',
    width: 800,
    height: 800,
  },
];
