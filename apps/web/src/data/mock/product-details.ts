import type { Locale } from '@/i18n/config'
import type { ProductCategoryGroup } from '@/types/catalog'

type EditorialCopy = {
	introduction: string
	application: string
	characteristics: string[]
}

const editorialCopy: Record<Locale, Record<ProductCategoryGroup, EditorialCopy>> = {
	ru: {
		perfume: {
			introduction: 'Композиция для тех, кто ценит выразительный, но спокойный шлейф. Наносите на точки пульса и дайте аромату раскрыться на коже.',
			application: 'Распылите с расстояния 10–15 см на кожу или одежду. Не растирайте аромат — так ноты раскрываются дольше.',
			characteristics: ['Парфюмерная вода', 'Сбалансированный шлейф', 'Для ежедневного ритуала']
		},
		makeup: {
			introduction: 'Продуманный продукт для выразительного образа без лишних усилий. Текстура легко наслаивается и остаётся комфортной в течение дня.',
			application: 'Нанесите небольшое количество и растушуйте. Для более насыщенного результата повторите нанесение тонким слоем.',
			characteristics: ['Комфортная текстура', 'Легко наслаивается', 'Для ежедневного макияжа']
		},
		skincare: {
			introduction: 'Минималистичный уход, который легко встроить в ежедневный ритуал. Формула оставляет ощущение комфорта и ухоженности.',
			application: 'Нанесите на очищенную кожу мягкими движениями. Используйте утром или вечером в зависимости от этапа ухода.',
			characteristics: ['Для домашнего ухода', 'Комфортное нанесение', 'Подходит для регулярного использования']
		},
		haircare: {
			introduction: 'Уход для заметного результата без утяжеления. Средство помогает сохранить мягкость и аккуратный вид волос.',
			application: 'Распределите по длине и оставьте на указанное время. Смойте тёплой водой или используйте как несмываемый уход, если это предусмотрено формулой.',
			characteristics: ['Для регулярного ухода', 'Лёгкая текстура', 'Не перегружает волосы']
		}
	},
	ro: {
		perfume: {
			introduction: 'O compoziție pentru cei care apreciază o urmă expresivă, dar discretă. Aplică pe punctele de puls și lasă parfumul să se deschidă pe piele.',
			application: 'Pulverizează de la 10–15 cm pe piele sau haine. Nu freca parfumul, pentru ca notele să se dezvolte mai mult timp.',
			characteristics: ['Apă de parfum', 'Urma echilibrată', 'Pentru ritualul zilnic']
		},
		makeup: {
			introduction: 'Un produs atent creat pentru un look expresiv, fără efort inutil. Textura se aplică în straturi și rămâne confortabilă pe parcursul zilei.',
			application: 'Aplică o cantitate mică și estompează. Pentru un rezultat mai intens, repetă aplicarea într-un strat subțire.',
			characteristics: ['Textură confortabilă', 'Se poate stratifica', 'Pentru machiajul zilnic']
		},
		skincare: {
			introduction: 'O îngrijire minimalistă, ușor de integrat în ritualul zilnic. Formula lasă o senzație de confort și piele îngrijită.',
			application: 'Aplică pe pielea curată, cu mișcări blânde. Folosește dimineața sau seara, în funcție de etapa rutinei.',
			characteristics: ['Pentru îngrijire acasă', 'Aplicare confortabilă', 'Potrivit pentru utilizare regulată']
		},
		haircare: {
			introduction: 'Îngrijire pentru un rezultat vizibil, fără să încarce. Ajută la păstrarea moliciunii și a aspectului îngrijit al părului.',
			application: 'Distribuie pe lungime și lasă să acționeze conform instrucțiunilor. Clătește cu apă călduță sau folosește ca îngrijire fără clătire, dacă formula permite.',
			characteristics: ['Pentru îngrijire regulată', 'Textură ușoară', 'Nu încarcă părul']
		}
	}
}

export function getProductEditorialCopy(locale: Locale, category: ProductCategoryGroup): EditorialCopy {
	return editorialCopy[locale][category]
}

export type { EditorialCopy }
