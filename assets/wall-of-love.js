class WallOfLove extends HTMLElement {
  #currentPage = 0;
  #pageCount = 1;
  #autoplayTimer = null;
  #isPlaying = false;
  #isDesktop = false;

  constructor() {
    super();
  }

  connectedCallback() {
    this.slides = this.querySelectorAll('[data-slide-index]');
    this.track = this.querySelector('.wall-of-love__track');
    this.dots = this.querySelectorAll('[data-dot]');
    this.prevBtn = this.querySelector('[data-prev]');
    this.nextBtn = this.querySelector('[data-next]');

    if (!this.track || this.slides.length <= 1) return;

    this.#updateLayout();

    this.prevBtn?.addEventListener('click', () => this.#prev());
    this.nextBtn?.addEventListener('click', () => this.#next());

    this.dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        const index = parseInt(dot.dataset.dot, 10);
        this.#goTo(Math.floor(index / this.#slidesPerView()));
      });
    });

    document.addEventListener('shopify:block:select', (event) => {
      if (!this.contains(event.target)) return;
      const slide = event.target.closest('[data-slide-index]');
      if (slide) {
        const index = parseInt(slide.dataset.slideIndex, 10);
        if (!isNaN(index)) {
          this.#goTo(Math.floor(index / this.#slidesPerView()));
          this.#stopAutoplay();
        }
      }
    });

    document.addEventListener('shopify:block:deselect', (event) => {
      if (!this.contains(event.target)) return;
      if (this.dataset.autoplay === 'true') {
        this.#startAutoplay();
      }
    });

    window.addEventListener('resize', () => {
      const wasDesktop = this.#isDesktop;
      this.#updateLayout();
      if (wasDesktop !== this.#isDesktop) {
        this.#goTo(0);
      }
    });

    if (this.dataset.autoplay === 'true') {
      this.#startAutoplay();
    }
  }

  disconnectedCallback() {
    this.#stopAutoplay();
  }

  #slidesPerView() {
    return this.#isDesktop ? 3 : 1;
  }

  #updateLayout() {
    this.#isDesktop = window.matchMedia('(min-width: 750px)').matches;
    this.#pageCount = Math.ceil(this.slides.length / this.#slidesPerView());
    this.#currentPage = Math.min(this.#currentPage, this.#pageCount - 1);
    this.#updateTrack();
  }

  #goTo(page) {
    page = Math.max(0, Math.min(page, this.#pageCount - 1));

    this.track.style.transform = `translateX(-${(page * this.#slidesPerView() * 100) / this.slides.length}%)`;

    this.dots.forEach((dot, i) => {
      const dotPage = Math.floor(i / this.#slidesPerView());
      dot.classList.toggle('is-active', dotPage === page);
    });

    this.#currentPage = page;

    if (this.dataset.autoplay === 'true') {
      this.#restartAutoplay();
    }
  }

  #updateTrack() {
    this.track.style.transform = `translateX(-${(this.#currentPage * this.#slidesPerView() * 100) / this.slides.length}%)`;

    this.dots.forEach((dot, i) => {
      const dotPage = Math.floor(i / this.#slidesPerView());
      dot.classList.toggle('is-active', dotPage === this.#currentPage);
    });
  }

  #next() {
    this.#goTo((this.#currentPage + 1) % this.#pageCount);
  }

  #prev() {
    this.#goTo((this.#currentPage - 1 + this.#pageCount) % this.#pageCount);
  }

  #startAutoplay() {
    if (this.#isPlaying) return;
    this.#isPlaying = true;

    const speed = parseInt(this.dataset.autoplaySpeed, 10) || 5000;
    this.#autoplayTimer = setInterval(() => this.#next(), speed);
  }

  #stopAutoplay() {
    this.#isPlaying = false;
    if (this.#autoplayTimer) {
      clearInterval(this.#autoplayTimer);
      this.#autoplayTimer = null;
    }
  }

  #restartAutoplay() {
    this.#stopAutoplay();
    this.#startAutoplay();
  }
}

if (!customElements.get('wall-of-love')) {
  customElements.define('wall-of-love', WallOfLove);
}