import Image from 'next/image';
import { Scissors } from 'lucide-react';

export function GallerySection() {
  return (
    <section
      id="galeria"
      className="border-b border-stone-200 bg-stone-900 text-stone-100"
    >
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <p className="text-xs font-medium text-amber-500">
              El espacio y el oficio
            </p>
            <h2 className="mt-3 max-w-xl font-[var(--font-playfair)] text-3xl font-semibold tracking-tight text-stone-50 [text-wrap:balance] sm:text-4xl">
              Un taller pensado para desconectar sin prisas
            </h2>
          </div>
          <p className="text-sm leading-relaxed text-stone-300 lg:col-span-5">
            Cada puesto cuenta con esterilización clínica de herramientas,
            navajas de un solo uso, toallas calientes con aceites esenciales y
            música ambiental a volumen de conversación.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-12">
          <figure className="lg:col-span-7">
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-stone-800 bg-stone-800">
              <div
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center bg-stone-800 text-stone-600"
              >
                <Scissors className="h-8 w-8" />
              </div>
              <Image
                src="/images/hero_barbershop_studio.jpg"
                alt="Estaciones de trabajo principales de Barbería Estudio"
                fill
                sizes="(max-width: 1024px) 100vw, 58vw"
                referrerPolicy="no-referrer"
                className="object-cover"
              />
            </div>
            <figcaption className="mt-3 text-xs text-stone-400">
              Estaciones privadas en madera de nogal e iluminación cálida.
            </figcaption>
          </figure>

          <figure className="lg:col-span-5">
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-stone-800 bg-stone-800 lg:aspect-auto lg:h-[calc(100%-1.75rem)]">
              <div
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center bg-stone-800 text-stone-600"
              >
                <Scissors className="h-8 w-8" />
              </div>
              <Image
                src="/images/gallery_tools_craft.jpg"
                alt="Tijeras japonesas, navaja clásica, brocha y tónico artesanal"
                fill
                sizes="(max-width: 1024px) 100vw, 40vw"
                referrerPolicy="no-referrer"
                className="object-cover"
              />
            </div>
            <figcaption className="mt-3 text-xs text-stone-400">
              Herramientas esterilizadas, acero japonés y tónicos botánicos.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
