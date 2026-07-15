import { ArrowRight, Quote, Sparkles, Target } from "lucide-react";

const frases = [
  {
    texto: "Comece onde você está. Use o que você tem. Faça o que você pode.",
    autor: "Arthur Ashe",
  },
  {
    texto: "A persistência é o caminho do êxito.",
    autor: "Charles Chaplin",
  },
  {
    texto: "O que você faz hoje pode melhorar todos os seus amanhãs.",
    autor: "Ralph Marston",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col justify-center py-4 sm:py-8">
      <section className="relative overflow-hidden rounded-3xl bg-slate-900 px-6 py-10 text-white shadow-xl sm:px-10 sm:py-14 lg:px-14">
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-sky-400/10 blur-3xl" />

        <div className="relative max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-slate-100">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Inspiração para o seu dia
          </div>
          <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Grandes resultados começam com um pequeno passo.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            Cada pedido concluído, cada cliente atendido e cada desafio superado constrói algo maior.
            Continue avançando.
          </p>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {frases.map((frase, index) => (
          <article
            key={frase.autor}
            className="group flex min-h-56 flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <Quote className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                0{index + 1}
              </span>
            </div>
            <blockquote className="mt-6 flex flex-1 flex-col">
              <p className="text-lg font-medium leading-7 text-slate-800">“{frase.texto}”</p>
              <footer className="mt-auto pt-5 text-sm text-slate-500">— {frase.autor}</footer>
            </blockquote>
          </article>
        ))}
      </section>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Target className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-slate-900">Foco do dia</h2>
            <p className="mt-1 text-sm text-slate-600">Escolha uma prioridade, dê o primeiro passo e mantenha o ritmo.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 self-end text-sm font-semibold text-slate-700 sm:self-auto">
          Vamos em frente
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
