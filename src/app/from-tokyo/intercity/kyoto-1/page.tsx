import Link from "next/link";
import { ImageCarousel } from "@/components/sections/ImageCarousel";

export default function KyotoFirstPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <ImageCarousel images={["/tours/kyoto-1/kyoto-1.jpg","/tours/kyoto-1/kyoto-2.jpg","/tours/kyoto-1/kyoto-3.jpg"]} alt="Киото" />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">День</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Киото. Первое знакомство</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Киото — древняя столица Японии, более тысячи лет служившая политическим и культурным центром страны. Именно здесь оформилась та японская эстетика, которую мы связываем с гармонией, утончённой простотой и глубокой связью с природой. Тур обязателен для тех, кто впервые прибыл в Киото.</p>
        </header>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
          <div className="space-y-8 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Золотой павильон Кинкакудзи</h3>
              <p>Самая «пафосная» и вместе с тем символичная локация Киото. Первоначально — загородная вилла сёгуна Асикага Ёсимицу XIV века, после его смерти сконвертированная в дзэн-буддийский храм. Золото, покрывающее здание, говорит не о богатстве, но о стремлении к чистоте. Павильон словно парит над зеркальной гладью пруда, создавая ощущение абсолютной гармонии.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Сад камней Рёандзи</h3>
              <p>На первый взгляд поражает простотой — пятнадцать камней на белом гравии, обнесённые низкой глиняной стеной. Камни расставлены так, что откуда бы вы ни смотрели, всегда видны только четырнадцать. Это воплощение японской идеи «ваби-саби» — красоты несовершенного и недолговечного.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Рынок Нисики</h3>
              <p>«Кухня Киото» — крытый рынок с несколькими веками истории. Здесь можно попробовать местные соленья, традиционные приправы, свежайшие морепродукты. Звон посуды, запахи соевых соусов и жареного угря, живые разговоры с продавцами — театральный опыт японской гастрономии.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Прогулка по склону Нинэндзака</h3>
              <p>Узкая извилистая улочка у подножия района Хигасияма, вымощенная камнем, окружена традиционными деревянными домами матия. Здесь — престижные рестораны кайсэки, чайные дома с многовековой историей, сувенирные лавки и один из лучших видов на Киото с пагодой Ясака.</p>
            </div>
            <div>
              <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25] mb-3">Квартал Гион</h3>
              <p>Самый знаменитый район Киото — эталон изысканного отдыха для аристократии и самурайской элиты. Узкие улочки с деревянными фасадами, свет бумажных фонарей, скрытые за невзрачными дверями чайные дома. Это «район гейш», где многие века можно было встретить геико и маико в изысканных кимоно.</p>
            </div>
          </div>
        </section>

        <Link
          href="/contact"
          className="inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
        >
          Связаться →
        </Link>
      </div>
    </section>
  );
}
