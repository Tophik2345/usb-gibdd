type WorkPhoto = {
  file: string;
  title: string;
  alt: string;
  width: number;
  height: number;
};

// Add only inspected, distinct Russia Online images without promotional text or HUD.
// Keep each original's provenance and checksum in public/gallery/sources.json.
export const workPhotos: WorkPhoto[] = [
  {
    file: 'dps-on-duty.webp',
    title: 'На службе: общение с водителем',
    alt: 'Два сотрудника ДПС разговаривают с водителем рядом с синим автомобилем и патрульной машиной в «России Онлайн».',
    width: 1810,
    height: 1018,
  },
];
