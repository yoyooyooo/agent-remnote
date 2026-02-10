import { usePlugin, renderWidget } from '@remnote/plugin-sdk';
import { useEffect, useState } from 'react';

export const SampleWidget = () => {
  const plugin = usePlugin();
  const [name, setName] = useState<string>('');
  const [likesPizza, setLikesPizza] = useState<boolean>(false);
  const [favoriteNumber, setFavoriteNumber] = useState<number>(0);

  useEffect(() => {
    (async () => {
      try {
        setName((await plugin.settings.getSetting<string>('name')) || '');
        setLikesPizza(!!(await plugin.settings.getSetting<boolean>('pizza')));
        const n = await plugin.settings.getSetting<number>('favorite-number');
        setFavoriteNumber(typeof n === 'number' ? n : 0);
      } catch {
        // ignore
      }
    })();
  }, []);

  return (
    <div className='p-2 m-2 rounded-lg rn-clr-background-light-positive rn-clr-content-positive'>
      <h1 className='text-xl'>Sample Plugin</h1>
      <div>
        Hi {name}, you {likesPizza ? 'do' : "don't"} like pizza and your favorite number is {favoriteNumber}!
      </div>
    </div>
  );
};

renderWidget(SampleWidget);
